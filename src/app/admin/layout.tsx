import type { ReactNode } from "react";
import { isAdminAuthenticated, adminLogout } from "./actions";
import AdminLoginForm from "./login-form";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const authenticated = await isAdminAuthenticated();

  if (!authenticated) {
    return <AdminLoginForm />;
  }

  return (
    <div className="flex flex-1 flex-col bg-slate-50 dark:bg-slate-950">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4 dark:border-slate-800 dark:bg-slate-900">
        <div>
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">Meu Mercado</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">Painel da plataforma</p>
        </div>
        <form action={adminLogout}>
          <button className="text-sm font-medium text-slate-500 hover:underline dark:text-slate-400">
            Sair
          </button>
        </form>
      </header>
      <main className="flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
    </div>
  );
}
