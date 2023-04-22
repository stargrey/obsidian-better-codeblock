import {
	ViewUpdate,
	PluginValue,
	EditorView,
	ViewPlugin,
	WidgetType,
	DecorationSet,
	Decoration,
	PluginSpec,
} from "@codemirror/view";
import { Settings, analyseFirstLine } from "./main";
import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder, StateEffect } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

export const resetEffect = StateEffect.define();

class LineNumberWiget extends WidgetType {
	constructor(private num: number, private setting: Settings) {
		super();
	}

	toDOM(view: EditorView): HTMLElement {
		const div = document.createElement("span");
		div.className = "better-code-block-line-num";
		div.innerText = this.num.toFixed();
		if (this.setting.showDividingLine) {
			div.style.borderRight = "1px currentColor solid";
		}
		return div;
	}
}

class LivePreviewPlugin implements PluginValue {
	setting: Settings;
	decorations: DecorationSet;

	constructor(view: EditorView) {
		this.decorations = this.buildDecorations(view);
	}

	update(update: ViewUpdate) {
		const hasRestEffect = update.transactions.find((transaction) =>
			transaction.effects.find((effect) => effect.is(resetEffect))
		);

		if (update.docChanged || update.viewportChanged || hasRestEffect) {
			this.decorations = this.buildDecorations(update.view);
		}
	}

	getLine(view: EditorView, node: SyntaxNode) {
		const line = view.state.doc.lineAt(node.from);
		return line;
	}

	buildDecorations(view: EditorView): DecorationSet {
		const builder = new RangeSetBuilder<Decoration>();
		const { from, to } = view.viewport;
		syntaxTree(view.state).iterate({
			from,
			to,
			enter: (node) => {
				if (
					node.type.name.startsWith(
						"HyperMD-codeblock_HyperMD-codeblock-begin"
					)
				) {
					const headLine = this.getLine(view, node.node);
					const lang = headLine.text
						.match(/^```\w+ ?/)?.[0]
						.slice(3, -1);
					if (lang && !this.setting.excludeLangs.includes(lang)) {
						const { highLightLines, title } = analyseFirstLine(
							headLine.text
						);
						this.renderCodeBlockNodes(
							builder,
							node.node.nextSibling,
							view,
							highLightLines
						);
					}
				}
			},
		});

		return builder.finish();
	}

	private renderCodeBlockNodes(
		builder: RangeSetBuilder<Decoration>,
		node: SyntaxNode | null,
		view: EditorView,
		highLightLines: number[]
	) {
		let index = 0;
		while (
			node &&
			!node.type.name.startsWith(
				"HyperMD-codeblock_HyperMD-codeblock-bg_HyperMD-codeblock-end"
			)
		) {
			const line = this.getLine(view, node);
			if (highLightLines.includes(index + 1)) {
				builder.add(
					line.from,
					line.from,
					Decoration.line({
						attributes: {
							style: `background-color: ${this.setting.highLightColor}`,
						},
					})
				);
			}
			if (this.setting.showLineNumber) {
				builder.add(
					line.from,
					line.from,
					Decoration.line({
						class: "better-code-block-line-show",
					})
				);

				builder.add(
					line.from,
					line.from,
					Decoration.widget({
						widget: new LineNumberWiget(index + 1, this.setting),
					})
				);
			}

			index++;
			node = node.nextSibling;
		}

		return builder;
	}
}

const pluginSpec: PluginSpec<LivePreviewPlugin> = {
	decorations: (value: LivePreviewPlugin) => value.decorations,
};

export function createLivePlugin(setting: Settings) {
	LivePreviewPlugin.prototype.setting = setting;
	return ViewPlugin.fromClass(LivePreviewPlugin, pluginSpec);
}
