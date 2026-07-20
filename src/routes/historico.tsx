import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { downloadExcelWorkbook } from "@/lib/excel-export";

export const Route = createFileRoute("/historico")({
  component: HistoricoPage,
});

type Sale = {
  id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  total: number;
  sold_at: string;
};

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const monthLabel = (d: Date) =>
  d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

function HistoricoPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [sales, setSales] = useState<Sale[]>([]);
  const [previousMonthTotal, setPreviousMonthTotal] = useState(0);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [openDay, setOpenDay] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) navigate({ to: "/auth" });
      else setReady(true);
    });
  }, [navigate]);

  useEffect(() => {
    if (!ready) return;
    const [y, m] = month.split("-").map(Number);
    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 1);
    const previousStart = new Date(y, m - 2, 1);

    Promise.all([
      supabase
        .from("sales")
        .select("*")
        .gte("sold_at", start.toISOString())
        .lt("sold_at", end.toISOString())
        .order("sold_at", { ascending: false }),
      supabase
        .from("sales")
        .select("total")
        .gte("sold_at", previousStart.toISOString())
        .lt("sold_at", start.toISOString()),
    ]).then(([current, previous]) => {
      setSales(current.data ? (current.data as Sale[]) : []);
      setPreviousMonthTotal(
        previous.data
          ? previous.data.reduce((sum, sale) => sum + Number(sale.total), 0)
          : 0,
      );
    });
  }, [ready, month]);

  // Agrupar por dia
  const byDay = useMemo(() => {
    const map = new Map<
      string,
      { total: number; count: number; items: Sale[] }
    >();
    for (const s of sales) {
      const d = new Date(s.sold_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const entry = map.get(key) ?? { total: 0, count: 0, items: [] };
      entry.total += Number(s.total);
      entry.count += 1;
      entry.items.push(s);
      map.set(key, entry);
    }
    return Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [sales]);

  const monthTotal = useMemo(
    () => sales.reduce((sum, s) => sum + Number(s.total), 0),
    [sales],
  );
  const monthCount = sales.length;
  const dayAvg = byDay.length ? monthTotal / byDay.length : 0;
  const monthClosingDiff = monthTotal - previousMonthTotal;
  const bestDay = byDay.reduce<{ day: string; total: number } | null>(
    (best, [day, v]) =>
      !best || v.total > best.total ? { day, total: v.total } : best,
    null,
  );

  // Fechamento: dia atual - dia anterior (dentro do mês selecionado)
  const closings = useMemo(() => {
    const list = byDay.slice().sort((a, b) => (a[0] < b[0] ? -1 : 1));
    return list
      .map(([day, v], i) => {
        const prev = i > 0 ? list[i - 1][1].total : 0;
        return { day, total: v.total, diff: v.total - prev };
      })
      .reverse();
  }, [byDay]);

  // Opções de mês (últimos 12)
  const monthOptions = useMemo(() => {
    const now = new Date();
    const opts: { value: string; label: string }[] = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      opts.push({
        value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
        label: monthLabel(d),
      });
    }
    return opts;
  }, []);

  const removeSale = async (id: string) => {
    if (!confirm("Remover esta venda?")) return;
    await supabase.from("sales").delete().eq("id", id);
    setSales((prev) => prev.filter((s) => s.id !== id));
  };

  const exportMonthlyReport = () => {
    const [y, m] = month.split("-").map(Number);
    const currentMonthDate = new Date(y, m - 1, 1);
    const monthName = monthLabel(currentMonthDate);

    downloadExcelWorkbook(`controle-caixa-mensal-${month}`, [
      {
        name: "Relatório mensal",
        tables: [
          {
            title: "Resumo do mês",
            headers: ["Campo", "Valor"],
            rows: [
              ["Mês", monthName],
              ["Total do mês", brl(monthTotal)],
              ["Total do mês anterior", brl(previousMonthTotal)],
              ["Fechamento do mês", brl(monthClosingDiff)],
              ["Vendas registradas", monthCount],
              ["Dias com venda", byDay.length],
              ["Média por dia", brl(dayAvg)],
              [
                "Melhor dia",
                bestDay
                  ? `${new Date(bestDay.day + "T00:00").toLocaleDateString("pt-BR")} - ${brl(bestDay.total)}`
                  : "-",
              ],
            ],
          },
          {
            title: "Fechamento por dia",
            headers: ["Data", "Vendas", "Total do dia", "Fechamento do dia"],
            rows: closings.map(({ day, total, diff }) => {
              const dayData = byDay.find(([d]) => d === day)?.[1];
              return [
                new Date(day + "T00:00").toLocaleDateString("pt-BR"),
                dayData?.count ?? 0,
                brl(total),
                brl(diff),
              ];
            }),
          },
          {
            title: "Vendas do mês",
            headers: [
              "Data",
              "Horário",
              "Item",
              "Quantidade",
              "Valor unitário",
              "Valor total",
            ],
            rows: sales.map((sale) => {
              const date = new Date(sale.sold_at);
              return [
                date.toLocaleDateString("pt-BR"),
                date.toLocaleTimeString("pt-BR", {
                  hour: "2-digit",
                  minute: "2-digit",
                }),
                sale.product_name,
                Number(sale.quantity),
                brl(Number(sale.unit_price)),
                brl(Number(sale.total)),
              ];
            }),
          },
          {
            title: "Total final",
            headers: ["Descrição", "Valor"],
            rows: [
              ["Total final do mês", brl(monthTotal)],
              ["Fechamento do mês", brl(monthClosingDiff)],
            ],
          },
        ],
      },
    ]);
  };

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Carregando...
      </div>
    );
  }

  const [y, m] = month.split("-").map(Number);
  const currentMonthDate = new Date(y, m - 1, 1);

  return (
    <div className="min-h-screen">
      <header className="border-b border-border">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-primary" />
            <span className="font-display text-xl font-bold tracking-tight">
              CAIXA
            </span>
          </Link>
          <nav className="flex items-center gap-2 text-sm">
            <Link
              to="/"
              className="rounded-lg px-3 py-1.5 text-muted-foreground hover:text-primary"
            >
              Hoje
            </Link>
            <Link
              to="/historico"
              className="rounded-lg px-3 py-1.5 bg-primary/10 text-primary font-medium"
            >
              Histórico
            </Link>
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8 space-y-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm text-muted-foreground">Controle mensal</p>
            <h1 className="text-3xl font-bold mt-1 capitalize">
              {monthLabel(currentMonthDate)}
            </h1>
          </div>
          <div className="flex items-end gap-3">
            <button
              type="button"
              onClick={exportMonthlyReport}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:border-primary hover:text-primary transition"
            >
              Exportar mensal
            </button>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">
                Selecionar mês
              </label>
              <select
                value={month}
                onChange={(e) => {
                  setMonth(e.target.value);
                  setOpenDay(null);
                }}
                className="rounded-lg bg-input border border-border px-3 py-2 outline-none focus:border-primary capitalize"
              >
                {monthOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard label="Total do mês" value={brl(monthTotal)} highlight />
          <SummaryCard label="Vendas registradas" value={String(monthCount)} />
          <SummaryCard label="Média por dia" value={brl(dayAvg)} />
          <SummaryCard
            label="Melhor dia"
            value={
              bestDay
                ? `${new Date(bestDay.day + "T00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} · ${brl(bestDay.total)}`
                : "—"
            }
          />
        </div>

        <section className="rounded-2xl border border-border bg-card">
          <div className="p-6 border-b border-border">
            <h2 className="text-lg font-semibold">Fechamento por dia</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Diferença = total do dia − total do dia anterior
            </p>
          </div>

          {byDay.length === 0 ? (
            <p className="text-sm text-muted-foreground p-8 text-center">
              Nenhuma venda neste mês.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {closings.map(({ day, total, diff }) => {
                const dayData = byDay.find(([d]) => d === day)![1];
                const isOpen = openDay === day;
                const dateObj = new Date(day + "T00:00");
                return (
                  <li key={day}>
                    <button
                      onClick={() => setOpenDay(isOpen ? null : day)}
                      className="w-full px-6 py-4 flex items-center justify-between gap-4 hover:bg-secondary/30 transition text-left"
                    >
                      <div>
                        <p className="font-medium capitalize">
                          {dateObj.toLocaleDateString("pt-BR", {
                            weekday: "short",
                            day: "2-digit",
                            month: "long",
                          })}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {dayData.count}{" "}
                          {dayData.count === 1 ? "venda" : "vendas"}
                        </p>
                      </div>
                      <div className="flex items-center gap-6">
                        <div className="text-right">
                          <p className="text-xs text-muted-foreground">Total</p>
                          <p className="font-semibold text-primary">
                            {brl(total)}
                          </p>
                        </div>
                        <div className="text-right min-w-[110px]">
                          <p className="text-xs text-muted-foreground">
                            Fechamento
                          </p>
                          <p
                            className={`font-semibold ${diff >= 0 ? "text-primary" : "text-destructive"}`}
                          >
                            {diff >= 0 ? "▲ " : "▼ "}
                            {brl(diff)}
                          </p>
                        </div>
                        <span className="text-muted-foreground text-lg">
                          {isOpen ? "−" : "+"}
                        </span>
                      </div>
                    </button>

                    {isOpen && (
                      <ul className="bg-background/40 divide-y divide-border">
                        {dayData.items.map((s) => (
                          <li
                            key={s.id}
                            className="px-6 py-3 flex items-center justify-between gap-3"
                          >
                            <div className="min-w-0">
                              <p className="font-medium truncate">
                                {s.product_name}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {Number(s.quantity)} ×{" "}
                                {brl(Number(s.unit_price))} •{" "}
                                {new Date(s.sold_at).toLocaleTimeString(
                                  "pt-BR",
                                  {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  },
                                )}
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
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-5 ${
        highlight ? "border-primary bg-primary/10" : "border-border bg-card"
      }`}
    >
      <p className="text-sm text-muted-foreground">{label}</p>
      <p
        className={`mt-2 text-xl font-bold ${highlight ? "text-primary" : "text-foreground"}`}
      >
        {value}
      </p>
    </div>
  );
}
