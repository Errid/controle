import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth")({
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/" });
    });
  }, [navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMsg(null);
    const normalizedEmail = email.trim().toLowerCase();

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });
      if (error) throw error;
      navigate({ to: "/" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro";
      setMsg(
        message === "Invalid login credentials"
          ? "Login ou senha inválidos no Supabase. Confira e-mail, senha e confirmação do usuário."
          : message,
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-primary" />
            <span className="font-display text-2xl font-bold">CAIXA</span>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Acesse com uma conta cadastrada no Supabase
          </p>
        </div>
        <form
          onSubmit={submit}
          className="rounded-2xl border border-border bg-card p-6 space-y-4"
        >
          <h1 className="text-xl font-semibold">Entrar</h1>
          <div className="space-y-2">
            <label className="text-sm text-muted-foreground">E-mail</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg bg-input border border-border px-3 py-2 outline-none focus:border-primary"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm text-muted-foreground">Senha</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg bg-input border border-border px-3 py-2 outline-none focus:border-primary"
            />
          </div>
          {msg && <p className="text-sm text-primary">{msg}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-primary text-primary-foreground font-semibold py-2.5 hover:opacity-90 transition disabled:opacity-60"
          >
            {loading ? "Carregando..." : "Entrar"}
          </button>
        </form>
      </div>
    </div>
  );
}
