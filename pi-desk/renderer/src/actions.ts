// App-wide actions any component can call (set by App): opening a file in the document panel.
export const actions = { openFile: (_path: string) => {} };

/** Files the document panel can show (the main process decides for sure; this only decides whether to offer it). */
export const VIEWABLE = /\.(pdf|png|jpe?g|gif|webp|svg|bmp|avif|md|markdown|csv|tsv|json|jsonl|html?|txt|log|ts|tsx|js|mjs|cjs|jsx|py|rb|go|rs|java|kt|cs|c|h|cpp|css|scss|sql|sh|ya?ml|toml|xml|vue|svelte|php)$/i;
