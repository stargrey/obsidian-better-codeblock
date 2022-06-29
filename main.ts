import { linkSync } from 'fs';
import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, MarkdownPostProcessorContext, Menu, SettingTab, TAbstractFile, TFile, SectionCache, Vault } from 'obsidian';
import { json } from 'stream/consumers';

const DEFAULT_LANG_ATTR = 'language-text'
const DEFAULT_LANG = ''
const LANG_REG = /^language-/
const LINE_SPLIT_MARK = '\n'

const titleRegExp = /TI:"([^"]*)"/i
const highLightLinesRegExp = /HL:"([^"]*)"/i
const foldRegExp = /"FOLD"/i

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
			app.workspace.on('resize', () => {
				resizeNumWrapAndHLWrap(el, ctx)
			})
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


export async function BetterCodeBlocks(el: HTMLElement, context: MarkdownPostProcessorContext, plugin: BetterCodeBlock) {
	const settings = plugin.settings
	const codeElm: HTMLElement = el.querySelector('pre > code')
	// only change pre>code
	if (!codeElm) { return }

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

	let codeBlock = context.getSectionInfo(codeElm)
	let codeBlockFirstLine = ""

	if(codeBlock) {
		let view = app.workspace.getActiveViewOfType(MarkdownView)
		codeBlockFirstLine = view.editor.getLine(codeBlock.lineStart)
	} else { 
		let file = app.vault.getAbstractFileByPath(context.sourcePath)
		let cache = app.metadataCache.getCache(context.sourcePath)
		let fileContent = await app.vault.cachedRead(<TFile> file)
		let fileContentLines = fileContent.split(/\n/g)

		let codeBlockFirstLines: string[] = []
		let codeBlockSections: SectionCache[] = []

		cache.sections?.forEach(async element => {
			if(element.type == "code") {
				let lineStart = element.position.start.line
				codeBlockFirstLine = fileContentLines[lineStart]
				codeBlockSections.push(element)
				codeBlockFirstLines.push(codeBlockFirstLine)
			}
		});
		exportPDF(el, plugin, codeBlockFirstLines, codeBlockSections)
		return
	}

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
	// const lineSize = contentList.length - 1
	const lineSize = codeBlock.lineEnd - codeBlock.lineStart - 1

	const cbMeta = { langName: lang, lineSize, pre, code: codeElm, title, isCollapse, div, contentList, highLightLines}

	const {showLineNumber} = plugin.settings

	addCodeTitleWrapper(plugin, pre, cbMeta)
	//addIconToTitle(plugin, pre, cbMeta)
	addCodeTitle(plugin, pre, cbMeta);

	// add line number
	if (showLineNumber) {
		addLineNumber(plugin, cbMeta)
	}

	addLineHighLight(plugin, pre, cbMeta)

	resizeNumWrapAndHLWrap(el,context) // 调用一次以解决某些时候打开文件行高未被重设高度
}

function createElement (tagName: string, defaultClassName?: string) {
	const element = document.createElement(tagName)
	if (defaultClassName) {
	  element.className = defaultClassName
	}
	return element
}

function addCodeTitleWrapper(plugin: BetterCodeBlock, preElm: HTMLElement, cbMeta: CodeBlockMeta) {
	preElm.style.setProperty("position", "relative", "important");
	preElm.style.setProperty("padding-top", CB_PADDING_TOP, "important");

	let wrapper = document.createElement("pre")
	if(cbMeta.isCollapse) {
		wrapper.setAttribute("closed","")
	}
	wrapper.className = "obsidian-embedded-code-title__code-block-title"

	wrapper.style.backgroundColor = plugin.settings.titleBackgroundColor || "#00000020";

	let collapser = createElement("div","collapser")
	let handle = createElement("div", "handle")
	collapser.appendChild(handle)
	wrapper.appendChild(collapser)

	wrapper.addEventListener('click',function(this: any) {
		if(wrapper.hasAttribute("closed")){
			wrapper.removeAttribute("closed")
		} else {
			wrapper.setAttribute("closed",'')
		}
	})

	preElm.appendChild(wrapper)
}

function addCodeTitle (plugin: BetterCodeBlock, preElm: HTMLElement, cbMeta: CodeBlockMeta) {
	let wrapper = preElm.querySelector(".obsidian-embedded-code-title__code-block-title")

	let titleElm = document.createElement("div")
	titleElm.className = "title"

	titleElm.appendText(cbMeta.title)
	wrapper.appendChild(titleElm)

	if(plugin.settings.titleFontColor) {
		titleElm.style.setProperty("color", plugin.settings.titleFontColor, "important")
	}
	
	if(plugin.settings.showLangNameInTopRight) {
		let langName = document.createElement("div"); // 在右侧添加代码类型
		let langNameString = cbMeta.langName
		langNameString = langNameString[0].toUpperCase() + langNameString.slice(1) // 首字母大写
		langName.appendText(langNameString);
		langName.className = "langName";
		wrapper.appendChild(langName);
	}

	preElm.prepend(wrapper);

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

function addLineHighLight(plugin: BetterCodeBlock, preElm: HTMLElement, cbMeta: CodeBlockMeta) {
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

	preElm.appendChild(highLightWrap)
}

function analyseHighLightLines(str: string): number[] {
	str = str.replace(/\s*/g, "") // 去除字符串中所有空格
	const result: number[] = []

	let strs = str.split(",")
	strs.forEach(it => {
		if(/\w+-\w+/.test(it)) { // 如果匹配 1-3 这样的格式，依次添加数字
			let left = Number(it.split('-')[0])
			let right = Number(it.split('-')[1])
			for(let i = left; i <= right; i++) {
				result.push(i)
			}
		} else {
			result.push(Number(it))
		}
	})

	return result
}

function addIconToTitle(plugin: BetterCodeBlock, preElm: HTMLElement, cbMeta: CodeBlockMeta) {
	let title = preElm.querySelectorAll(".obsidian-embedded-code-title__code-block-title")

	title.forEach(it => {
		let iconWrap = createElement("div","icon-wrap")
		let icon = document.createElement("img")
		icon.src = ""
		iconWrap.appendChild(icon)
		it.appendChild(iconWrap)
	})
	
}

// 在自动换行时对数字和高亮行重新设置高度
// These codes refer to the https://github.com/lijyze/obsidian-advanced-codeblock
function resizeNumWrapAndHLWrap(el: HTMLElement, context: MarkdownPostProcessorContext) {
	setTimeout(async function(){ // 延时100毫秒以解决某些时候打开文件行高未被重设高度
		// console.log('on resize')
		let codeBlockEl : HTMLElement = el.querySelector('pre > code')
		if(!codeBlockEl) return

		let numWrap = el.querySelector('.code-block-linenum-wrap')
		let highWrap = el.querySelector('.code-block-highlight-wrap')

		let codeBlockInfo = context.getSectionInfo(codeBlockEl)
		// let view = app.workspace.getActiveViewOfType(MarkdownView)
		// let codeBlockLineNum = codeBlockInfo.lineEnd - codeBlockInfo.lineStart - 1 // 除去首尾两行
		let view
		let codeBlockLineNum

		let lineStart = 0
		let lineEnd = 0
		if(codeBlockInfo) {
			view = app.workspace.getActiveViewOfType(MarkdownView)
			codeBlockLineNum = codeBlockInfo.lineEnd - codeBlockInfo.lineStart - 1 // 除去首尾两行
		} else {
			return
			// let file = app.vault.getAbstractFileByPath(context.sourcePath)
			// let cache = app.metadataCache.getCache(context.sourcePath)
	
			// cache.sections?.forEach(async element => {
			// 	if(element.type == "code") {
			// 		lineStart = element.position.start.line
			// 		lineEnd = element.position.end.line
			// 		codeBlockLineNum = lineEnd - lineStart - 1
			// 		return
			// 	}
			// });
			// let file = app.vault.getAbstractFileByPath(context.sourcePath)
			// let cache = app.metadataCache.getCache(context.sourcePath)
			// let fileContent = await app.vault.cachedRead(<TFile> file)
			// let fileContentLines = fileContent.split(/\n/g)
		}

		let span = createElement("span")

		for(let i = 0; i < codeBlockLineNum; i++) {
			let oneLineText
			if(view){
				oneLineText = view.editor.getLine(codeBlockInfo.lineStart + i + 1)
			} else {
				// oneLineText = fileContentLines[lineStart + 1 + i]
				// let file = app.vault.getAbstractFileByPath(context.sourcePath)
				// let cache = app.metadataCache.getCache(context.sourcePath)
				// let fileContent = await app.vault.cachedRead(<TFile> file)
				// let fileContentLines = fileContent.split(/\n/g)
				// oneLineText = fileContentLines[cache.sections]
			}
			span.innerHTML = oneLineText || "0"

			codeBlockEl.appendChild(span)
			span.style.display = 'block'

			let lineHeight = span.getBoundingClientRect().height + 'px' // 测量本行文字的高度

			// console.log(lineHeight + '    ' + span.getBoundingClientRect().width);
			
			let numOneLine = numWrap? numWrap.childNodes[i] as HTMLElement : null
			let hlOneLine = highWrap? highWrap.childNodes[i] as HTMLElement : null

			if(numOneLine) numOneLine.style.height = lineHeight;
			if(hlOneLine) hlOneLine.style.height = lineHeight;

			span.remove() // 测量完后删掉
		}
	}, 100)
}

function exportPDF(el: HTMLElement, plugin: BetterCodeBlock, codeBlockFirstLines: string[], codeBlockSections: SectionCache[]) {
	let codeBlocks = el.querySelectorAll('pre > code')
	codeBlocks.forEach((codeElm, key) => {
		let langName = "", title = "", highLightLines: number[] = []
		codeElm.classList.forEach(value => {
			if(LANG_REG.test(value)) {
				langName = value.replace('language-', '')
				return
			}
		})

		if(codeBlockFirstLines[key].match(titleRegExp) != null) {
			title = codeBlockFirstLines[key].match(titleRegExp)[1]
		}
		if(codeBlockFirstLines[key].match(highLightLinesRegExp) != null) {
			let highLightLinesInfo = codeBlockFirstLines[key].match(highLightLinesRegExp)[1]
			highLightLines = analyseHighLightLines(highLightLinesInfo)
		}

		let lineSize = codeBlockSections[key].position.end.line - codeBlockSections[key].position.start.line - 1

		let cbMeta: CodeBlockMeta = {
			langName: langName,
			lineSize: lineSize,
			pre: codeElm.parentElement,
			code: codeElm as HTMLElement,
			title: title,
			isCollapse: false,
			div: codeElm.parentElement.parentElement,
			contentList: [],
			highLightLines: highLightLines
		}
		addCodeTitleWrapper(plugin, codeElm.parentElement, cbMeta) // 导出取消代码块折叠
		addCodeTitle(plugin, cbMeta.pre, cbMeta)
		if(plugin.settings.showLineNumber) {
			addLineNumber(plugin, cbMeta)
		}
		addLineHighLight(plugin, cbMeta.pre, cbMeta)
	})
}