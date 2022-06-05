import { linkSync } from 'fs';
import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, MarkdownPostProcessorContext, Menu, SettingTab, TAbstractFile, TFile } from 'obsidian';

const DEFAULT_LANG_ATTR = 'language-text'
const DEFAULT_LANG = ''
const LANG_REG = /^language-/
const LINE_SPLIT_MARK = '\n'

const CB_PADDING_TOP = "35px" // 代码块上边距

interface Settings {
	substitutionTokenForSpace: string;
	titleBackgroundColor: string;
	titleFontColor: string;
	highLightColor: string;

	excludeLangs: string[]; // 需要排除的语言

	showLineNumber: boolean; // 显示行号
	showDividingLine: boolean;
	showLangNameInTopRight: boolean;
}

const DEFAULT_SETTINGS: Settings = {
	substitutionTokenForSpace: undefined,
	titleBackgroundColor: "#00000020",
	titleFontColor: undefined,
	highLightColor: "#2d82cc20",

	excludeLangs: [],

	showLineNumber: true,
	showDividingLine: false,
	showLangNameInTopRight: true
};

interface CodeBlockMeta {
	// Language name
	langName: string;

	// Code block total line size
	lineSize: number;

	// Code block 'pre' HTMLElement
	pre: HTMLElement;

	// Code block 'code' HTMLElement
	code: HTMLElement;

	title: string; // 代码块标题
	isCollapse:boolean; // 是否默认折叠

	// Code block wrap div
	div: HTMLElement;
	contentList: string[];
	highLightLines: number[];
}

// Refer https://developer.mozilla.org/ja/docs/Web/JavaScript/Guide/Regular_Expressions#escaping
function escapeRegExp(str: string): string {
	return str.replace(/[.*+?^=!:${}()|[\]\/\\]/g, "\\$&"); // 为特殊符号加上转义符号"\"
}

export default class BetterCodeBlock extends Plugin {
	settings: Settings;

	async onload() {
		console.log("Loading Better Code Block Plugin");
		await this.loadSettings();
		this.addSettingTab(new BetterCodeBlockTab(this.app, this));
		this.registerMarkdownPostProcessor((el, ctx) => {
			BetterCodeBlocks(el, ctx, this)
		})
	}

	onunload () {
		console.log('Unloading Better Code Block Plugin');
	}
	
	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}
	
	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class BetterCodeBlockTab extends PluginSettingTab {
	plugin: BetterCodeBlock;
  
	constructor(app: App, plugin: BetterCodeBlock) {
	  super(app, plugin);
	  this.plugin = plugin;
	}
  
	display(): void {
	  let { containerEl } = this;
  
	  containerEl.empty();
	
	  new Setting(containerEl)
		.setName("Exclude language list")
		.setDesc("Title and line numbers do not apply in these languages, separate by `,`")
		.addText(text => text.setPlaceholder('like todoist,other,...')
		.setValue(this.plugin.settings.excludeLangs.join(','))
		.onChange(async (value) => {
			this.plugin.settings.excludeLangs = value.split(',');
			await this.plugin.saveSettings();
		})
		)
  
	  new Setting(containerEl).setName("Font color of title").addText((tc) =>
		tc
		  .setPlaceholder("Enter a color")
		  .setValue(this.plugin.settings.titleFontColor)
		  .onChange(async (value) => {
			this.plugin.settings.titleFontColor = value;
			await this.plugin.saveSettings();
		  })
	  );
  
	  new Setting(containerEl)
		.setName("Background color of title")
		.addText((tc) =>
		  tc
			.setPlaceholder("#00000020")
			.setValue(this.plugin.settings.titleBackgroundColor)
			.onChange(async (value) => {
			  this.plugin.settings.titleBackgroundColor = value;
			  await this.plugin.saveSettings();
			})
		);

		new Setting(containerEl)
		.setName("HighLight Color")
		.addText((tc) =>
		  tc
			.setPlaceholder("#2d82cc20")
			.setValue(this.plugin.settings.highLightColor)
			.onChange(async (value) => {
			  this.plugin.settings.highLightColor = value;
			  await this.plugin.saveSettings();
			})
		);

		new Setting(containerEl)
		.setName("Show line number")
		.addToggle((tc) => 
		tc.setValue(this.plugin.settings.showLineNumber)
		.onChange(async(value) => {
			this.plugin.settings.showLineNumber = value;
			await this.plugin.saveSettings();
		})
		)

		new Setting(containerEl)
		.setName("Show dividing line")
		.addToggle((tc) =>
		tc.setValue(this.plugin.settings.showDividingLine)
		.onChange(async(value) => {
			this.plugin.settings.showDividingLine = value;
			await this.plugin.saveSettings();
		})
		)

		new Setting(containerEl)
		.setName("Show language name in the top right")
		.addToggle((tc) =>
		tc.setValue(this.plugin.settings.showLangNameInTopRight)
		.onChange(async(value) => {
			this.plugin.settings.showLangNameInTopRight = value;
			await this.plugin.saveSettings();
		})
		)
	}
  }

export function BetterCodeBlocks(el: HTMLElement, context: MarkdownPostProcessorContext, plugin: BetterCodeBlock) {
	const settings = plugin.settings
	
	const codeElm: HTMLElement = el.querySelector('pre > code')
	// only change pre>code
	if (!codeElm) {
	  return
	}

	let lang = DEFAULT_LANG
	// return when lang is in exclude list
	if (plugin.settings.excludeLangs.some(eLangName => codeElm.classList.contains(`language-${eLangName}`))) {
	  return
	}
	
	codeElm.classList.forEach((value, key, parent) => {
	  if (LANG_REG.test(value)) {
		lang = value.replace('language-', '')
		return
	  }
	})

	// if the code block is not described, return
	if(lang == DEFAULT_LANG) {
		return
	}

	let titleRegExp = /TI:"([^"]*)"/i
	let highLightLinesRegExp = /HL:"([^"]*)"/i
	let foldRegExp = /"FOLD"/i

	let codeBlock = context.getSectionInfo(codeElm)
	let view = app.workspace.getActiveViewOfType(MarkdownView)
	let codeBlockFirstLine = view.editor.getLine(codeBlock.lineStart)

	let title: string = ""
	let highLightLines: number[] = []
	if(codeBlockFirstLine.match(titleRegExp) != null) {
		title = codeBlockFirstLine.match(titleRegExp)[1]
	}
	if(codeBlockFirstLine.match(highLightLinesRegExp) != null) {
		let highLightLinesInfo = codeBlockFirstLine.match(highLightLinesRegExp)[1]
		highLightLines = analyseHighLightLines(highLightLinesInfo)
	}

	let isCollapse = false;
	if(foldRegExp.test(codeBlockFirstLine)) {
		isCollapse = true
	}

	const pre = codeElm.parentElement // code-block-pre__has-linenum
	const div = pre.parentElement // class code-block-wrap

	/* const { lineStart, lineEnd } = ctx.getSectionInfo(el)
	const lineSize = lineEnd - lineStart - 1 */
	const contentList: string[] = codeElm.textContent.split(LINE_SPLIT_MARK)
	const lineSize = contentList.length - 1

	const cbMeta: CodeBlockMeta = { langName: lang, lineSize, pre, code: codeElm, title, isCollapse, div, contentList, highLightLines}

	const {showLineNumber} = plugin.settings

	addCodeTitle(plugin, pre, cbMeta);

	// add line number
	if (showLineNumber) {
		addLineNumber(plugin, cbMeta)
	}

	addLineHighLight(plugin, pre, cbMeta)
}

function createElement (tagName: string, defaultClassName?: string) {
	const element = document.createElement(tagName)
	if (defaultClassName) {
	  element.className = defaultClassName
	}
	return element
}

function addLineNumber (plugin: BetterCodeBlock, cbMeta: CodeBlockMeta) {
	const { lineSize, pre, div } = cbMeta
	// let div position: relative;
	div.classList.add('code-block-wrap')
	// const { fontSize, lineHeight } = window.getComputedStyle(cbMeta.code)
	const lineNumber = createElement('span', 'code-block-linenum-wrap')
	lineNumber.style.top = CB_PADDING_TOP;
	Array.from({ length: lineSize }, (v, k) => k).forEach(i => {
	  const singleLine = createElement('span', 'code-block-linenum')
	  // singleLine.style.fontSize = fontSize
	  // singleLine.style.lineHeight = lineHeight
	  lineNumber.appendChild(singleLine)
	})
	
	if(plugin.settings.showDividingLine) {
		lineNumber.style.borderRight = "1px currentColor solid"
	}

	pre.appendChild(lineNumber)
	pre.classList.add('code-block-pre__has-linenum')
}


function addCodeTitle (plugin: BetterCodeBlock, wrapperElm: HTMLElement, cbMeta: CodeBlockMeta) {
	wrapperElm.style.setProperty("position", "relative", "important");
	wrapperElm.style.setProperty("padding-top", CB_PADDING_TOP, "important");

	wrapperElm
	  .querySelectorAll(".obsidian-embedded-code-title__code-block-title")
	  .forEach((x) => x.remove()); // 防抖动

	let d = document.createElement("pre");
	// d.appendText(cbMeta.title);
	d.appendText(cbMeta.title)

	if(cbMeta.isCollapse) {
		d.setAttribute("closed","")
	}
	d.className = "obsidian-embedded-code-title__code-block-title";

	if(plugin.settings.titleFontColor) {
		d.style.setProperty("color", plugin.settings.titleFontColor, "important")
	}
	d.style.backgroundColor = plugin.settings.titleBackgroundColor || "#00000020";

	let collapser = createElement("div","collapser")
	let handle = createElement("div", "handle")
	collapser.appendChild(handle)
	d.appendChild(collapser)

	if(plugin.settings.showLangNameInTopRight) {
		let langName = document.createElement("div"); // 在右侧添加代码类型
		let langNameString = cbMeta.langName
		langNameString = langNameString[0].toUpperCase() + langNameString.slice(1) // 首字母大写
		langName.appendText(langNameString);
		langName.className = "langName";
		d.appendChild(langName);
	}
	d.addEventListener('click',function(this) {
		if(d.hasAttribute("closed")){
			d.removeAttribute("closed")
		} else {
			d.setAttribute("closed",'')
		}
	})
	wrapperElm.prepend(d);
}

function addLineHighLight(plugin: BetterCodeBlock, wrapperElm: HTMLElement, cbMeta: CodeBlockMeta) {
	if(cbMeta.highLightLines.length == 0) return

	let highLightWrap = document.createElement("pre")
	highLightWrap.className = "code-block-highlight-wrap"
	for(let i = 0; i < cbMeta.lineSize; i++) {
		const singleLine = createElement("span", 'code-block-highlight')
		if(cbMeta.highLightLines.contains(i+1)) {
			singleLine.style.backgroundColor = plugin.settings.highLightColor || "#2d82cc20"
		}
		highLightWrap.appendChild(singleLine)
	}

	wrapperElm.appendChild(highLightWrap)
}

function analyseHighLightLines(str: string): number[] {
	str = str.replace(/\s*/g, "") // 去除字符串中所有空格
	const result: number[] = []

	let strs = str.split(",")
	strs.forEach(it => {
		if(/\w-\w/.test(it)) { // 如果匹配 1-3 这样的格式，依次添加数字
			for(let i = Number(it[0]); i <= Number(it[2]); i++) {
				result.push(i)
			}
		} else {
			result.push(Number(it))
		}
	})

	return result
}