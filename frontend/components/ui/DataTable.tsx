import { ReactNode } from "react";

export type Column<T> = {
  key: keyof T | string;
  label: string;
  render?: (row: T) => ReactNode;
};

type DataTableProps<T> = {
  columns: Column<T>[];
  rows: T[];
  mobileTitle: (row: T) => string;
  mobileMeta?: (row: T) => string;
};

export function DataTable<T extends object>({ columns, rows, mobileTitle, mobileMeta }: DataTableProps<T>) {
  const readValue = (row: T, key: keyof T | string) => String(row[key as keyof T] ?? "");

  return (
    <div>
      <div className="hidden overflow-hidden rounded-lg border bg-card md:block">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/70 text-muted-foreground">
            <tr>
              {columns.map((column) => (
                <th key={String(column.key)} className="px-4 py-3 font-medium">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row, index) => (
              <tr key={index} className="hover:bg-muted/35">
                {columns.map((column) => (
                  <td key={String(column.key)} className="px-4 py-3">
                    {column.render ? column.render(row) : readValue(row, column.key)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-3 md:hidden">
        {rows.map((row, index) => (
          <div key={index} className="rounded-lg border bg-card p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-medium">{mobileTitle(row)}</h3>
                {mobileMeta ? <p className="mt-1 text-sm text-muted-foreground">{mobileMeta(row)}</p> : null}
              </div>
              {columns.at(-1)?.render?.(row)}
            </div>
            <dl className="mt-4 grid grid-cols-1 gap-2 text-sm">
              {columns.slice(1, -1).map((column) => (
                <div key={String(column.key)} className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">{column.label}</dt>
                  <dd className="text-right">{column.render ? column.render(row) : readValue(row, column.key)}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </div>
  );
}
