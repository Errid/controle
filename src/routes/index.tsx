import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";
import { downloadExcelWorkbook } from "@/lib/excel-export";

export const Route = createFileRoute("/")({
  component: HomePage,
});

type Product = { id: string; name: string; price: number };
type Sale = {
  id: string;
  product_id: string | null;
  product_name: string;
  quantity: number;
  unit_price: number;
  total: number;
  sold_at: string;
};

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const normalizeSearch = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

function HomePage() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);

  // form state
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [selectedId, setSelectedId] = useState<string>("");
  const [productSearch, setProductSearch] = useState("");
  const [qty, setQty] = useState("1");
  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [exportingDaily, setExportingDaily] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        navigate({ to: "/auth" });
        return;
      }
      setUser(data.session.user);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!session) {
        navigate({ to: "/auth" });
        return;
      }
      setUser(session.user);
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate]);

  const load = async () => {
    const [p, s] = await Promise.all([
      supabase.from("products").select("*").order("name"),
      supabase
        .from("sales")
        .select("*")
        .gte(
          "sold_at",
          new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString(),
        )
        .order("sold_at", { ascending: false }),
    ]);
    if (p.data) setProducts(p.data as Product[]);
    if (s.data) setSales(s.data as Sale[]);
  };

  useEffect(() => {
    if (ready) load();
  }, [ready]);

  const filteredProducts = useMemo(() => {
    const search = normalizeSearch(productSearch.trim());
    if (!search) return products;

    return products.filter((product) =>
      normalizeSearch(product.name).includes(search),
    );
  }, [products, productSearch]);

  useEffect(() => {
    if (!filteredProducts.length) {
      setSelectedId("");
      return;
    }

    if (!filteredProducts.some((product) => product.id === selectedId)) {
      setSelectedId(filteredProducts[0].id);
    }
  }, [filteredProducts, selectedId]);

  // fechamento: total hoje vs total ontem
  const { todayTotal, yesterdayTotal, todaySales } = useMemo(() => {
    const now = new Date();
    const startToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const startYest = new Date(startToday);
    startYest.setDate(startYest.getDate() - 1);
    let today = 0;
    let yest = 0;
    const list: Sale[] = [];
    for (const s of sales) {
      const d = new Date(s.sold_at);
      if (d >= startToday) {
        today += Number(s.total);
        list.push(s);
      } else if (d >= startYest && d < startToday) {
        yest += Number(s.total);
      }
    }
    return { todayTotal: today, yesterdayTotal: yest, todaySales: list };
  }, [sales]);

  const closingDiff = todayTotal - yesterdayTotal;

  const exportDailyReport = async () => {
    const now = new Date();
    const startToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const startTomorrow = new Date(startToday);
    startTomorrow.setDate(startTomorrow.getDate() + 1);
    const startYesterday = new Date(startToday);
    startYesterday.setDate(startYesterday.getDate() - 1);
    const dayLabel = now.toLocaleDateString("pt-BR");
    const fileDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    setExportingDaily(true);
    try {
      const [todayResult, yesterdayResult] = await Promise.all([
        supabase
          .from("sales")
          .select("*")
          .gte("sold_at", startToday.toISOString())
          .lt("sold_at", startTomorrow.toISOString())
          .order("sold_at", { ascending: false }),
        supabase
          .from("sales")
          .select("total")
          .gte("sold_at", startYesterday.toISOString())
          .lt("sold_at", startToday.toISOString()),
      ]);

      if (todayResult.error) throw todayResult.error;
      if (yesterdayResult.error) throw yesterdayResult.error;

      const dailySales = (todayResult.data ?? []) as Sale[];
      const dailyTotal = dailySales.reduce(
        (sum, sale) => sum + Number(sale.total),
        0,
      );
      const previousTotal = (yesterdayResult.data ?? []).reduce(
        (sum, sale) => sum + Number(sale.total),
        0,
      );
      const dailyClosingDiff = dailyTotal - previousTotal;

      downloadExcelWorkbook(`controle-caixa-diario-${fileDate}`, [
        {
          name: "Relatório diário",
          tables: [
            {
              title: "Resumo do dia",
              headers: ["Campo", "Valor"],
              rows: [
                ["Data", dayLabel],
                ["Total do dia", brl(dailyTotal)],
                ["Total do dia anterior", brl(previousTotal)],
                ["Fechamento do dia", brl(dailyClosingDiff)],
                ["Vendas registradas", dailySales.length],
              ],
            },
            {
              title: "Vendas do dia",
              headers: [
                "Horário",
                "Item",
                "Quantidade",
                "Valor unitário",
                "Valor total",
              ],
              rows: dailySales.map((sale) => [
                new Date(sale.sold_at).toLocaleTimeString("pt-BR", {
                  hour: "2-digit",
                  minute: "2-digit",
                }),
                sale.product_name,
                Number(sale.quantity),
                brl(Number(sale.unit_price)),
                brl(Number(sale.total)),
              ]),
            },
            {
              title: "Total final",
              headers: ["Descrição", "Valor"],
              rows: [
                ["Total final do dia", brl(dailyTotal)],
                ["Fechamento do dia", brl(dailyClosingDiff)],
              ],
            },
          ],
        },
      ]);
    } catch (err) {
      alert(
        err instanceof Error
          ? `Não foi possível exportar o relatório diário: ${err.message}`
          : "Não foi possível exportar o relatório diário.",
      );
    } finally {
      setExportingDaily(false);
    }
  };

  const registerSale = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setBusy(true);
    try {
      const quantity = Number(qty.replace(",", ".")) || 0;
      if (quantity <= 0) throw new Error("Quantidade inválida");

      let productId: string | null = null;
      let name = "";
      let price = 0;

      if (mode === "existing") {
        const p = products.find((x) => x.id === selectedId);
        if (!p) throw new Error("Selecione um produto");
        productId = p.id;
        name = p.name;
        price = Number(p.price);
      } else {
        name = newName.trim();
        price = Number(newPrice.replace(",", ".")) || 0;
        if (!name) throw new Error("Nome do produto obrigatório");
        if (price <= 0) throw new Error("Preço inválido");
        const { data, error } = await supabase
          .from("products")
          .insert({ user_id: user.id, name, price })
          .select()
          .single();
        if (error) throw error;
        productId = data.id;
      }

      const total = price * quantity;
      const { error } = await supabase.from("sales").insert({
        user_id: user.id,
        product_id: productId,
        product_name: name,
        quantity,
        unit_price: price,
        total,
      });
      if (error) throw error;

      setQty("1");
      setNewName("");
      setNewPrice("");
      setProductSearch("");
      if (mode === "new") setMode("existing");
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro");
    } finally {
      setBusy(false);
    }
  };

  const removeSale = async (id: string) => {
    if (!confirm("Remover esta venda?")) return;
    await supabase.from("sales").delete().eq("id", id);
    load();
  };

  const removeProduct = async (id: string, name: string) => {
    if (
      !confirm(
        `Remover o produto "${name}"? As vendas antigas continuam no historico.`,
      )
    ) {
      return;
    }

    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) {
      alert(error.message);
      return;
    }

    if (selectedId === id) setSelectedId("");
    await load();
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Carregando...
      </div>
    );
  }

  const today = new Date().toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  });

  return (
    <div className="min-h-screen">
      <header className="border-b border-border">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-primary" />
            <span className="font-display text-xl font-bold tracking-tight">
              CAIXA
            </span>
          </div>
          <nav className="flex items-center gap-2 text-sm">
            <Link
              to="/"
              className="rounded-lg px-3 py-1.5 bg-primary/10 text-primary font-medium"
            >
              Hoje
            </Link>
            <Link
              to="/historico"
              className="rounded-lg px-3 py-1.5 text-muted-foreground hover:text-primary"
            >
              Histórico
            </Link>
            <span className="hidden sm:inline text-muted-foreground ml-2">
              {user?.email}
            </span>
            <button
              onClick={signOut}
              className="rounded-lg border border-border px-3 py-1.5 text-muted-foreground hover:border-primary hover:text-primary transition"
            >
              Sair
            </button>
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8 space-y-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm text-muted-foreground capitalize">{today}</p>
            <h1 className="text-3xl font-bold mt-1">Controle de Caixa</h1>
          </div>
          <button
            type="button"
            onClick={exportDailyReport}
            disabled={exportingDaily}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:border-primary hover:text-primary transition"
          >
            {exportingDaily ? "Exportando..." : "Exportar diário"}
          </button>
        </div>

        {/* Cards resumo */}
        <div className="grid gap-4 sm:grid-cols-3">
          <SummaryCard
            label="Vendas de hoje"
            value={brl(todayTotal)}
            highlight
          />
          <SummaryCard label="Vendas de ontem" value={brl(yesterdayTotal)} />
          <SummaryCard
            label="Fechamento (hoje − ontem)"
            value={brl(closingDiff)}
            trend={closingDiff >= 0 ? "up" : "down"}
          />
        </div>

        <div className="grid gap-8 lg:grid-cols-[1fr_1.2fr]">
          {/* Formulário */}
          <section className="rounded-2xl border border-border bg-card p-6">
            <h2 className="text-lg font-semibold mb-4">Registrar venda</h2>

            <div className="flex gap-2 mb-4">
              <TabBtn
                active={mode === "existing"}
                onClick={() => setMode("existing")}
                disabled={products.length === 0}
              >
                Produto cadastrado
              </TabBtn>
              <TabBtn
                active={mode === "new"}
                onClick={() => {
                  setMode("new");
                  setProductSearch("");
                }}
              >
                Novo produto
              </TabBtn>
            </div>

            <form onSubmit={registerSale} className="space-y-4">
              {mode === "existing" ? (
                products.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nenhum produto cadastrado. Cadastre um em "Novo produto".
                  </p>
                ) : (
                  <div className="space-y-2">
                    <label className="text-sm text-muted-foreground">
                      Produto
                    </label>
                    <input
                      value={productSearch}
                      onChange={(e) => setProductSearch(e.target.value)}
                      className="w-full rounded-lg bg-input border border-border px-3 py-2 outline-none focus:border-primary"
                      placeholder="Digite para procurar um produto"
                    />
                    {filteredProducts.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        Nenhum produto encontrado para essa busca.
                      </p>
                    ) : (
                      <select
                        value={selectedId}
                        onChange={(e) => setSelectedId(e.target.value)}
                        className="w-full rounded-lg bg-input border border-border px-3 py-2 outline-none focus:border-primary"
                      >
                        {filteredProducts.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} — {brl(Number(p.price))}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                )
              ) : (
                <>
                  <div className="space-y-2">
                    <label className="text-sm text-muted-foreground">
                      Nome do produto
                    </label>
                    <input
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      required
                      className="w-full rounded-lg bg-input border border-border px-3 py-2 outline-none focus:border-primary"
                      placeholder="Ex: Coca-Cola 350ml"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm text-muted-foreground">
                      Preço unitário (R$)
                    </label>
                    <input
                      value={newPrice}
                      onChange={(e) => setNewPrice(e.target.value)}
                      inputMode="decimal"
                      required
                      className="w-full rounded-lg bg-input border border-border px-3 py-2 outline-none focus:border-primary"
                      placeholder="0,00"
                    />
                  </div>
                </>
              )}

              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">
                  Quantidade
                </label>
                <input
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  inputMode="decimal"
                  required
                  className="w-full rounded-lg bg-input border border-border px-3 py-2 outline-none focus:border-primary"
                />
              </div>

              <button
                disabled={busy || (mode === "existing" && !selectedId)}
                className="w-full rounded-lg bg-primary text-primary-foreground font-semibold py-2.5 hover:opacity-90 transition disabled:opacity-60"
              >
                {busy ? "Registrando..." : "Registrar venda"}
              </button>
            </form>

            {products.length > 0 && (
              <div className="mt-6 pt-6 border-t border-border">
                <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wider">
                  Produtos cadastrados
                </h3>
                {filteredProducts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nenhum produto encontrado para essa busca.
                  </p>
                ) : (
                  <ul className="space-y-1.5 max-h-48 overflow-y-auto">
                    {filteredProducts.map((p) => (
                      <li
                        key={p.id}
                        className="flex items-center justify-between gap-3 text-sm py-1"
                      >
                        <span className="min-w-0 truncate">{p.name}</span>
                        <div className="flex shrink-0 items-center gap-3">
                          <span className="text-primary font-medium">
                            {brl(Number(p.price))}
                          </span>
                          <button
                            type="button"
                            onClick={() => removeProduct(p.id, p.name)}
                            className="text-xs text-muted-foreground hover:text-destructive"
                            aria-label={`Remover ${p.name}`}
                            title="Remover produto"
                          >
                            Remover
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>

          {/* Vendas do dia */}
          <section className="rounded-2xl border border-border bg-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Vendas de hoje</h2>
              <span className="text-sm text-muted-foreground">
                {todaySales.length} {todaySales.length === 1 ? "item" : "itens"}
              </span>
            </div>
            {todaySales.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                Nenhuma venda registrada hoje ainda.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {todaySales.map((s) => (
                  <li
                    key={s.id}
                    className="py-3 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="font-medium truncate">{s.product_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {Number(s.quantity)} × {brl(Number(s.unit_price))} •{" "}
                        {new Date(s.sold_at).toLocaleTimeString("pt-BR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-primary font-semibold">
                        {brl(Number(s.total))}
                      </span>
                      <button
                        onClick={() => removeSale(s.id)}
                        className="text-xs text-muted-foreground hover:text-destructive"
                        title="Remover"
                      >
                        ✕
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-6 pt-4 border-t border-border flex items-center justify-between">
              <span className="text-muted-foreground">Total do dia</span>
              <span className="text-2xl font-bold text-primary">
                {brl(todayTotal)}
              </span>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  highlight,
  trend,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  trend?: "up" | "down";
}) {
  return (
    <div
      className={`rounded-2xl border p-5 ${
        highlight ? "border-primary bg-primary/10" : "border-border bg-card"
      }`}
    >
      <p className="text-sm text-muted-foreground">{label}</p>
      <p
        className={`mt-2 text-2xl font-bold ${
          highlight
            ? "text-primary"
            : trend === "down"
              ? "text-destructive"
              : trend === "up"
                ? "text-primary"
                : "text-foreground"
        }`}
      >
        {trend === "up" ? "▲ " : trend === "down" ? "▼ " : ""}
        {value}
      </p>
    </div>
  );
}

function TabBtn({
  active,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition border ${
        active
          ? "bg-primary text-primary-foreground border-primary"
          : "border-border text-muted-foreground hover:text-foreground disabled:opacity-40"
      }`}
    >
      {children}
    </button>
  );
}
