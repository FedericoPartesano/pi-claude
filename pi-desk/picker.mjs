/**
 * "Indica a Pi": run in the browser panel's page. Outlines what the mouse is over; a click resolves with what the
 * element is (role, text, a CSS selector, a short HTML excerpt, where it is); Esc resolves with null. The page's own
 * click is swallowed, so picking never presses the button.
 */
export const PICKER_SCRIPT = `new Promise((resolve) => {
	const box = document.createElement("div");
	box.style.cssText = "position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #2ee6ff;background:rgba(46,230,255,.14);box-shadow:0 0 12px #2ee6ff88;border-radius:3px;transition:all .06s";
	const tag = document.createElement("div");
	tag.style.cssText = "position:fixed;pointer-events:none;z-index:2147483647;font:600 11px ui-monospace,monospace;color:#0c0c0c;background:#2ee6ff;padding:2px 6px;border-radius:3px";
	document.documentElement.append(box, tag);
	const selector = (el) => {
		if (el.id) return "#" + CSS.escape(el.id);
		const parts = [];
		for (let node = el; node && node.nodeType === 1 && parts.length < 5; node = node.parentElement) {
			if (node.id) { parts.unshift("#" + CSS.escape(node.id)); break; }
			let part = node.localName;
			const classes = [...node.classList].filter((c) => !/^(is-|has-|ng-|css-)|\\d{3,}/.test(c)).slice(0, 2);
			if (classes.length) part += "." + classes.map((c) => CSS.escape(c)).join(".");
			const siblings = node.parentElement ? [...node.parentElement.children].filter((s) => s.localName === node.localName) : [];
			if (siblings.length > 1) part += ":nth-of-type(" + (siblings.indexOf(node) + 1) + ")";
			parts.unshift(part);
		}
		return parts.join(" > ");
	};
	const name = (el) => (el.getAttribute("aria-label") || el.getAttribute("alt") || el.getAttribute("title") || el.getAttribute("placeholder") || el.innerText || el.value || "").trim().replace(/\\s+/g, " ").slice(0, 120);
	const role = (el) => el.getAttribute("role") || ({ a: "link", button: "button", input: el.type === "checkbox" ? "checkbox" : "textbox", select: "combobox", textarea: "textbox", img: "img", h1: "heading", h2: "heading", h3: "heading" })[el.localName] || el.localName;
	let current;
	const move = (event) => {
		current = event.target;
		const r = current.getBoundingClientRect();
		Object.assign(box.style, { left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
		tag.textContent = role(current) + (name(current) ? " · " + name(current).slice(0, 40) : "");
		Object.assign(tag.style, { left: r.left + "px", top: Math.max(0, r.top - 20) + "px" });
	};
	const done = (value) => {
		removeEventListener("mousemove", move, true);
		removeEventListener("click", click, true);
		removeEventListener("keydown", key, true);
		box.remove();
		tag.remove();
		resolve(value);
	};
	const click = (event) => {
		event.preventDefault();
		event.stopPropagation();
		const el = event.target;
		const r = el.getBoundingClientRect();
		done({ role: role(el), name: name(el), selector: selector(el), html: el.outerHTML.slice(0, 400), url: location.href, rect: { x: Math.max(0, r.left - 6), y: Math.max(0, r.top - 6), width: Math.min(innerWidth, r.width + 12), height: Math.min(innerHeight, r.height + 12) } });
	};
	const key = (event) => event.key === "Escape" && (event.preventDefault(), done(null));
	addEventListener("mousemove", move, true);
	addEventListener("click", click, true);
	addEventListener("keydown", key, true);
})`;

/** What goes into the composer: enough for Pi to find the element again (snapshot ref, selector, or the picture). */
export function pickedText(pick) {
	const what = `${pick.role}${pick.name ? ` «${pick.name}»` : ""}`;
	return `Nel browser (${pick.url}) ho indicato questo elemento: ${what}\nselettore: \`${pick.selector}\`\n`;
}
