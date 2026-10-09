// The renderer (Solid) is built into ui-dist/, which the Electron main process loads from disk (file://). Module
// scripts from file:// can be refused (origin "null"): the bundle is one classic script, loaded with defer.
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

const classicScript = {
	name: "classic-script",
	enforce: "post",
	transformIndexHtml: (html) => html.replace(/<script type="module" crossorigin src=/g, "<script defer src=").replace(/ crossorigin/g, ""),
};

export default defineConfig({
	root: "renderer",
	base: "./",
	plugins: [solid(), classicScript],
	build: {
		outDir: "../ui-dist",
		emptyOutDir: true,
		target: "chrome140",
		modulePreload: false,
		rollupOptions: { output: { format: "iife", inlineDynamicImports: true } },
	},
});
