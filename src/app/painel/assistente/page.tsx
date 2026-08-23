"use client";

import { useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { useStore } from "@/lib/store-context";

type Message = { role: "user" | "assistant"; content: string };

// TypeScript não tem os tipos da Web Speech API por padrão — declaração
// mínima só do que a gente usa, pra não precisar de lib externa.
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: { [i: number]: { [j: number]: { transcript: string } } } }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};

export default function Assistente() {
  const store = useStore();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [voiceReplies, setVoiceReplies] = useState(true);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const { data } = await getSupabase()
        .from("assistant_messages")
        .select("role, content")
        .eq("store_id", store.id)
        .order("created_at", { ascending: true })
        .limit(50);
      setMessages((data ?? []) as Message[]);
      setLoading(false);
    }
    load();
  }, [store.id]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
    const Recognition = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    setVoiceSupported(!!Recognition && "speechSynthesis" in window);
  }, []);

  async function speak(text: string) {
    if (!voiceReplies) return;
    const {
      data: { session },
    } = await getSupabase().auth.getSession();
    if (!session) return;

    try {
      setSpeaking(true);
      const res = await fetch("/api/assistente/voz", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      audioRef.current?.pause();
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => setSpeaking(false);
      audio.onerror = () => setSpeaking(false);
      await audio.play();
    } catch {
      setSpeaking(false);
    }
  }

  function toggleListening() {
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
    const Recognition = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Recognition) return;

    if (listening) {
      recognitionRef.current?.stop();
      return;
    }

    const recognition = new Recognition();
    recognition.lang = "pt-BR";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript;
      if (transcript) sendMessage(transcript);
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setError(null);
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
    setSending(true);

    const {
      data: { session },
    } = await getSupabase().auth.getSession();
    if (!session) {
      setSending(false);
      return;
    }

    try {
      const res = await fetch("/api/assistente/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ store_id: store.id, message: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Não deu pra falar com o assistente agora.");
        return;
      }
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
      speak(data.reply);
    } catch {
      setError("Não deu pra falar com o assistente agora — confere sua internet.");
    } finally {
      setSending(false);
    }
  }

  async function handleClear() {
    if (!confirm("Apagar todo o histórico de conversa com o assistente?")) return;
    await getSupabase().from("assistant_messages").delete().eq("store_id", store.id);
    setMessages([]);
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-8rem)] max-w-2xl flex-col">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Assistente</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Conhece o financeiro, vendas, tráfego e reclamações da sua loja. Converse por texto ou voz.
          </p>
        </div>
        {messages.length > 0 && (
          <button onClick={handleClear} className="shrink-0 text-xs text-slate-400 underline hover:text-slate-600 dark:hover:text-slate-300">
            Limpar conversa
          </button>
        )}
      </div>

      <div ref={scrollRef} className="mt-4 flex-1 space-y-3 overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        {loading ? (
          <p className="text-sm text-slate-400">Carregando…</p>
        ) : messages.length === 0 ? (
          <p className="text-sm text-slate-400">
            Puxa uma conversa — pergunta sobre sua margem, um produto parado, de onde vem o tráfego, o que quiser.
          </p>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                  m.role === "user"
                    ? "bg-blue-900 text-amber-50 dark:bg-blue-800"
                    : "border border-slate-200 bg-slate-50 text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                }`}
              >
                {m.content}
              </div>
            </div>
          ))
        )}
        {sending && <p className="text-xs text-slate-400">Pensando…</p>}
      </div>

      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          sendMessage(input);
        }}
        className="mt-3 flex items-center gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Escreva ou toque no microfone..."
          className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
        />
        {voiceSupported && (
          <button
            type="button"
            onClick={toggleListening}
            title={listening ? "Parar de ouvir" : "Falar"}
            className={`shrink-0 rounded-full p-2.5 ${
              listening ? "bg-red-600 text-white" : "border border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-300"
            }`}
          >
            {listening ? "🔴" : "🎙️"}
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            setVoiceReplies((v) => !v);
            audioRef.current?.pause();
            setSpeaking(false);
          }}
          title={voiceReplies ? "Respostas por voz ligadas" : "Respostas por voz desligadas"}
          className={`shrink-0 rounded-full border border-slate-300 p-2.5 text-slate-600 dark:border-slate-700 dark:text-slate-300 ${speaking ? "animate-pulse" : ""}`}
        >
          {voiceReplies ? "🔊" : "🔇"}
        </button>
        <button
          type="submit"
          disabled={sending || !input.trim()}
          className="shrink-0 rounded-lg bg-blue-900 px-4 py-2.5 text-sm font-semibold text-amber-300 disabled:opacity-50 dark:bg-blue-800"
        >
          Enviar
        </button>
      </form>
    </div>
  );
}
