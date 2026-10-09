import { createMemo, createSignal, For, Show } from "solid-js";
import { ArrowDown, ArrowUp } from "lucide-solid";

const numeric = (value: string) => /^-?[\d.,\s]+%?$/.test(value.trim()) && value.trim() !== "";
const toNumber = (value: string) => Number(value.replace(/\s|%/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));

/** A CSV as a table: sticky header, click a column to sort (numbers as numbers), row count. */
export function Table(props: { rows: string[][]; truncated?: boolean }) {
	const [sort, setSort] = createSignal<{ column: number; down: boolean }>();
	const header = () => props.rows[0] ?? [];
	const numericColumns = createMemo(() => header().map((_, column) => props.rows.slice(1, 50).every((row) => !row[column] || numeric(row[column]))));
	const body = createMemo(() => {
		const rows = props.rows.slice(1);
		const by = sort();
		if (!by) return rows;
		const factor = by.down ? -1 : 1;
		return [...rows].sort((a, b) => {
			const x = a[by.column] ?? "";
			const y = b[by.column] ?? "";
			return factor * (numericColumns()[by.column] ? toNumber(x) - toNumber(y) : x.localeCompare(y, "it", { numeric: true }));
		});
	});
	return (
		<div class="doc-table">
			<table>
				<thead>
					<tr>
						<For each={header()}>
							{(cell, column) => (
								<th classList={{ right: numericColumns()[column()] }} onClick={() => setSort({ column: column(), down: sort()?.column === column() ? !sort()!.down : false })}>
									{cell}
									<Show when={sort()?.column === column()}>{sort()!.down ? <ArrowDown size={11} /> : <ArrowUp size={11} />}</Show>
								</th>
							)}
						</For>
					</tr>
				</thead>
				<tbody>
					<For each={body()}>{(row) => <tr><For each={header()}>{(_, column) => <td classList={{ right: numericColumns()[column()] }}>{row[column()] ?? ""}</td>}</For></tr>}</For>
				</tbody>
			</table>
			<div class="doc-foot">{props.rows.length - 1} righe{props.truncated ? " (troncato)" : ""}</div>
		</div>
	);
}
