import katex from 'katex';
import { readFile } from '@tauri-apps/plugin-fs';

type Card = {
    id: string;
    deck_id: string;
    concept_id: string;
    title: string;
    content: string;
    card_type: string;
};
type SessionState = {
    thesis: Card;
    evidenceDeck: Card[];
    currentStep: number;
    isEvidenceRevealed: boolean;
    currentCard: Card | null;
    sprintTotal: number;
    sprintCompleted: number;
};
type Correlation = { name: string; similarity: number; };

class ApiClient {
    private baseUrl = 'http://localhost:3000';

    private async request<T>(endpoint: string, options?: RequestInit): Promise<T> {
        const response = await fetch(`${this.baseUrl}${endpoint}`, {
            ...options,
            headers: { 'Content-Type': 'application/json', ...options?.headers },
        });
        if (!response.ok) {
            const error = await response.json().catch(() => ({ message: response.statusText }));
            throw new Error(`API request failed: ${error.message || response.statusText}`);
        }
        return response.json() as T;
    }

    getTheses(): Promise<Card[]> { return this.request<Card[]>('/theses'); }
    startSession(thesisId: string, isInfinite: boolean): Promise<SessionState> { return this.request<SessionState>('/session/start', { method: 'POST', body: JSON.stringify({ thesisId, isInfinite }) }); }
    processInput(key: string): Promise<SessionState> { return this.request<SessionState>('/session/process', { method: 'POST', body: JSON.stringify({ key }) }); }
    getCorrelations(conceptId: string): Promise<Correlation[]> { return this.request<Correlation[]>(`/correlations/${conceptId}`); }
    addCard(data: { title: string, content: string }): Promise<Card> { return this.request<Card>('/cards/add', { method: 'POST', body: JSON.stringify(data) }); }
}

// --- Main Application Class ---
class BeautifulMindApp {
    private rootEl: HTMLElement;
    private apiClient: ApiClient;

    private state = {
        activeTab: 'synapse' as 'synapse' | 'add',
        status: 'connecting' as 'connecting' | 'ready' | 'error',
        theses: [] as Card[],
        session: null as SessionState | null,
        addCardStatus: '' as '' | 'success' | 'error',
        correlations: [] as Correlation[],
    };

    constructor(selector: string) {
        this.rootEl = document.querySelector(selector)!;
        this.apiClient = new ApiClient();
        this.init();
    }

    async init() {
        this.attachGlobalKeyListeners();
        try {
            this.state.theses = await this.apiClient.getTheses();
            this.state.status = 'ready';
        } catch (e) { this.handleError(e); }
        await this.render();
    }
    
    attachGlobalKeyListeners() {
        document.addEventListener('keydown', (e) => {
            if (e.key === '1') { this.state.activeTab = 'synapse'; this.state.session = null; this.render(); return; }
            if (e.key === '2') { this.state.activeTab = 'add'; this.render(); return; }
            if (this.state.activeTab === 'synapse' && this.state.session && this.state.session.currentCard) {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.processInput('enter'); }
                if (e.key === 'ArrowUp') { e.preventDefault(); this.processInput('up'); }
                if (e.key === 'ArrowDown') { e.preventDefault(); this.processInput('down'); }
            }
        });
    }

    async processInput(key: string) {
        if (!this.state.session) return;
        try {
            const newState = await this.apiClient.processInput(key);
            const shouldFetchCorrelations = this.state.session.currentCard?.id !== newState.currentCard?.id;
            this.state.session = newState; 
            await this.render(shouldFetchCorrelations);
        } catch(e) { this.handleError(e); }
    }
    
    handleError(e: any) { console.error(e); this.state.status = 'error'; this.render(); }
    
    async renderCardContent(text: string): Promise<string> {
        if (!text) return '';
    
        const placeholders = new Map<string, string>();
        let placeholderId = 0;
        let processedText = text;
    
        // (IMAGES AND $$...$$)
        // replace all block elements with a temporary, unique placeholder.
        // prevents the inline parser from ever seeing their content.
    
        // Images: ![alt](src)
        const imageRegex = /!\[(.*?)\]\((.*?)\)/g;
        for (const match of processedText.matchAll(imageRegex)) {
            const [fullMatch, alt, url] = match;
            const placeholder = `__BLOCK_PLACEHOLDER_${placeholderId++}__`;
            let replacementHtml = '';
            if (url.startsWith('http')) {
                replacementHtml = `<img src="${url}" alt="${alt}" class="card-image">`;
            } else {
                try {
                    const assetUrl = url;
                    replacementHtml = `<img src="${assetUrl}" alt="${alt}" class="card-image">`;
                } catch (e) {
                    replacementHtml = `<span class="error">Invalid local image: ${url}</span>`;
                }
            }
            placeholders.set(placeholder, replacementHtml);
            processedText = processedText.replace(fullMatch, placeholder);
        }

        const latexRegex = /\$\$(.*?)\$\$|\$([^\$\n]+?)\$/gs;
        processedText = processedText.replace(latexRegex, (match, blockContent, inlineContent) => {
            const latex = blockContent ?? inlineContent;
            const displayMode = blockContent !== undefined;
            const normalizedLatex = latex.replace(/\\\\/g, '\\');
            return katex.renderToString(normalizedLatex, { throwOnError: false, displayMode })
                    .replace(/<span class="katex-mathml">.*?<\/span>/g, '');
        });
    
        const lines = processedText.split('\n');
        const finalHtmlBlocks: string[] = [];
    
        for (const line of lines) {
            const trimmedLine = line.trim();
            if (trimmedLine === '') continue;
    
            const placeholderMatch = trimmedLine.match(/^__BLOCK_PLACEHOLDER_(\d+)__$/);
            if (placeholderMatch) {
                // it's an image block restore it directly without a <p> tag.
                finalHtmlBlocks.push(placeholders.get(trimmedLine)!);
            } else if (trimmedLine.startsWith('<div class="katex-display"')) {
                // it's a KaTeX block add it directly without a <p> tag.
                finalHtmlBlocks.push(trimmedLine);
            } else {
                // restore any images that are inline with text.
                let inlineRestoredLine = trimmedLine;
                placeholders.forEach((value, key) => {
                    inlineRestoredLine = inlineRestoredLine.replace(key, value);
                });
                finalHtmlBlocks.push(`<p>${inlineRestoredLine}</p>`);
            }
        }
        
        return finalHtmlBlocks.join('');
        
        // // Block LaTeX: $$...$$
        // const blockLatexRegex = /\$\$(.*?)\$\$/gs;
        // processedText = processedText.replace(blockLatexRegex, (match, latex) => {
        //     const placeholder = `__BLOCK_PLACEHOLDER_${placeholderId++}__`;
        //     const normalizedLatex = latex.replace(/\\\\/g, '\\');
        //     const renderedHtml = katex.renderToString(normalizedLatex, { throwOnError: false, displayMode: true });
        //     placeholders.set(placeholder, renderedHtml);
        //     return placeholder;
        // });
    
        // // INLINE ELEMENTS ($...$)
        // // blocks are gone, we can safely process inline elements.
        // const inlineLatexRegex = /\$([^\$\n]+?)\$/g; // This regex now ignores newlines to be safer
        // processedText = processedText.replace(inlineLatexRegex, (match, latex) => {
        //     const normalizedLatex = latex.replace(/\\\\/g, '\\');
        //     return katex.renderToString(normalizedLatex, { throwOnError: false, displayMode: false });
        // });
        // console.log(processedText);

        // // split the text into paragraphs and then substitute the placeholders back in.
        // let finalHtml = processedText
        //     .split('\n')
        //     .filter(line => line.trim() !== '')
        //     .map(p => `<p>${p}</p>`)
        //     .join('');
    
        // placeholders.forEach((value, key) => {
        //     finalHtml = finalHtml.replace(`<p>${key}</p>`, value);
        // });
    
        // return finalHtml;
    }

    async render(fetchCorrelations = true) {
        if (this.state.status === 'ready' && this.state.session?.currentCard && fetchCorrelations) {
            try { this.state.correlations = await this.apiClient.getCorrelations(this.state.session.currentCard.concept_id); } 
            catch (e) { console.warn("Could not fetch correlations", e); this.state.correlations = []; }
        }
        
        let content = '';
        if (this.state.status === 'connecting') content = `<div class="panel"><h1>connecting to engine...</h1></div>`;
        else if (this.state.status === 'error') content = `<div class="panel error"><h1>connection error. is backend running?</h1></div>`;
        else {
            switch (this.state.activeTab) {
                case 'synapse': content = await this.renderSynapse(); break;
                case 'add': content = await this.renderAddCard(); break;
            }
        }
        
        this.rootEl.innerHTML = `
            <style>${this.getStyles()}</style>
            <div class="container">
                <nav class="tabs">
                    <button data-tab="synapse" class="${this.state.activeTab === 'synapse' ? 'active' : ''}">Beautiful Mind (1)</button>
                    <button data-tab="add" class="${this.state.activeTab === 'add' ? 'active' : ''}">Add Card (2)</button>
                </nav>
                <div class="content">${content}</div>
            </div>`;
        this.attachEventListeners();
    }
    
    attachEventListeners() {
        this.rootEl.querySelector('.tabs')?.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            if (target.matches('button[data-tab]')) {
                this.state.activeTab = target.dataset.tab as any;
                this.state.session = null;
                this.render();
            }
        });
        
        this.rootEl.querySelector('.content')?.addEventListener('click', async (e) => {
            const target = e.target as HTMLElement;
            if (target.matches('button[data-action]')) {
                const action = target.dataset.action;
                if (action === 'add-card') await this.handleAddCard();
                else await this.processInput(action);
            } else if (target.closest('.menu-item[data-id]')) {
                const menuItem = target.closest('.menu-item[data-id]') as HTMLElement;
                const thesisId = menuItem.dataset.id!;
                const isInfinite = (target as HTMLElement).dataset.infinite === 'true';
                try {
                    this.state.session = await this.apiClient.startSession(thesisId, isInfinite);
                    await this.render();
                } catch(e) { this.handleError(e); }
            }
        });

        const contentInput = this.rootEl.querySelector<HTMLTextAreaElement>('#content-input');
        if (contentInput) {
            contentInput.addEventListener('input', async () => {
                const previewEl = this.rootEl.querySelector<HTMLElement>('#preview-content');
                if (previewEl) {
                    previewEl.innerHTML = await this.renderCardContent(contentInput.value);
                }
            });
        }
    }

    async handleAddCard() {
        const titleEl = document.getElementById('title-input') as HTMLInputElement;
        const contentEl = document.getElementById('content-input') as HTMLTextAreaElement;
        if (!titleEl.value || !contentEl.value) {
            this.state.addCardStatus = 'error';
            await this.render();
            return;
        }
        try {
            await this.apiClient.addCard({ title: titleEl.value, content: contentEl.value });
            this.state.addCardStatus = 'success';
            titleEl.value = '';
            contentEl.value = '';
        } catch(e) { this.state.addCardStatus = 'error'; }
        await this.render();
    }

    async renderSynapse(): Promise<string> {
        if (!this.state.session) {
            return `
                <div class="panel">
                    <h2>Select a Thesis to Begin Your Journey</h2>
                    ${this.state.theses.map(thesis => `
                        <div class="menu-item" data-id="${thesis.id}">
                            <div><strong>${thesis.title}</strong><span class="faint">from deck '${thesis.deck_id}'</span></div>
                            <div><button data-infinite="false">Start Sprint</button><button data-infinite="true">Start Infinite Journey</button></div>
                        </div>
                    `).join('') || '<p class="faint">No theses found. Check your deck files.</p>'}
                </div>`;
        }
        
        if (!this.state.session.currentCard) {
            return `<div class="panel"><h2>Session complete!</h2>
            <p>You answered ${this.state.session.sprintCompleted} of ${this.state.session.sprintTotal} initial evidence cards.</p></div>`;
        }
        
        return `
            <div class="session-grid">
                <div class="panel context-view">${await this.renderContextView()}</div>
                <div class="panel journey-view">${await this.renderJourneyView()}</div>
                <div class="panel interaction-view">${await this.renderInteractionView()}</div>
            </div>`;
    }

    async renderContextView(): Promise<string> {
        const s = this.state.session!;
        const relatedHTML = this.state.correlations.map(c => `<span class="related-concept">${c.name}</span>`).join(' ');
        return `
            <div class="panel-header">CONTEXT VIEW</div>
            <p><strong>Thesis:</strong> ${s.thesis.title}</p>
            <p><strong>Related concepts:</strong> ${relatedHTML || 'None found.'}</p>
        `;
    }

    async renderJourneyView(): Promise<string> {
        const s = this.state.session!;
        const evidenceHTML = s.evidenceDeck.map((card, index) => {
            let icon = '○';
            let iconColor = 'var(--faint-color)';
            if (index < s.currentStep) { icon = '✓'; iconColor = 'var(--correct-color)'; } 
            else if (index === s.currentStep) { icon = '▷'; iconColor = 'var(--accent-color)'; }
            const activeClass = index === s.currentStep ? 'active' : '';
            const title = (index > s.currentStep || (index === s.currentStep && !s.isEvidenceRevealed)) ? '???' : card.title;
            return `<li class="${activeClass}"><span class="icon" style="color: ${iconColor};">${icon}</span> Evidence: ${title}</li>`;
        }).join('');

        return `
            <div class="panel-header">JOURNEY / THESIS VIEW</div>
            <div class="thesis-content">${await this.renderCardContent(s.thesis.content)}</div>
            <ul class="evidence-list">${evidenceHTML}</ul>
            <p class="progress-bar">Progress: ${s.sprintCompleted} of ${s.sprintTotal} sprint cards answered</p>
        `;
    }

    async renderInteractionView(): Promise<string> {
        const s = this.state.session!;
        const card = s.currentCard!;
        
        let contentHTML = '';
        if (!s.isEvidenceRevealed) {
            contentHTML = `
                <div class="prompt">Prompt: "${card.title}"</div>
                <div class="answer-area"><p class="faint">[ Answer hidden. Press Enter or click Reveal. ]</p></div>
                <div class="controls"><button data-action="enter">Reveal</button></div>
            `;
        } else {
            const isSprintCard = s.currentStep < s.sprintTotal;
            const controlsHTML = isSprintCard
                ? `<div class="relation-tagging">
                        <div class="relation-label">Relation tagging:</div>
                        <button data-action="up" title="Supports (ArrowUp)">(↑) SUPPORTS</button>
                        <button data-action="down" title="Refutes (ArrowDown)">(↓) REFUTES</button>
                   </div>`
                : `<div class="controls"><button data-action="enter">Next (Enter)</button></div>`;

            contentHTML = `
                <div class="prompt">Prompt: "${card.title}"</div>
                <div class="answer-area content-view">${await this.renderCardContent(card.content)}</div>
                ${controlsHTML}
            `;
        }
        return `<div class="panel-header">INTERACTION VIEW</div>${contentHTML}`;
    }

    async renderAddCard(): Promise<string> {
        let statusHTML = '';
        if (this.state.addCardStatus === 'success') statusHTML = `<p class="status success">card added.</p>`;
        if (this.state.addCardStatus === 'error') statusHTML = `<p class="status error">error adding card.</p>`;
        return `<div class="add-card-grid"><div class="panel add-card-form"><h2>Add a New Card</h2><label for="title">Title</label><input type="text" id="title-input" placeholder="e.g., The Dot Product"><label for="content">Content (Markdown + LaTeX with $$...$$)</label><textarea id="content-input" rows="10" placeholder="e.g., $$ a \\cdot b = \\sum_{i=1}^{n} a_i b_i $$"></textarea><button data-action="add-card">Add Card</button>${statusHTML}</div><div class="panel live-preview"><h2>Live Preview</h2><div id="preview-content" class="content-preview">Type in the content box...</div></div></div>`;
    }

    getStyles(): string {
        return `
:root { --bg-color: #1a1a1a; --panel-bg: #2a2a2a; --border-color: #444; --text-color: #ddd; --faint-color: #888; --accent-color: #00aaff; --correct-color: #4CAF50; --incorrect-color: #F44336; }
* { box-sizing: border-box; }
body { background-color: var(--bg-color); color: var(--text-color); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 0; }
.container { max-width: 1200px; margin: auto; padding: 1rem; }
.content { margin-top: 1rem; }
.panel { background-color: var(--panel-bg); border: 1px solid var(--border-color); padding: 1rem; border-radius: 8px; }
.panel-header { font-weight: bold; text-transform: uppercase; color: var(--faint-color); border-bottom: 1px solid var(--border-color); padding-bottom: 0.5rem; margin: -1rem -1rem 1rem -1rem; padding: 0.5rem 1rem; background-color: #333; border-radius: 8px 8px 0 0;}
.error { color: var(--incorrect-color); } .faint { color: var(--faint-color); }
.tabs { display: flex; gap: 4px; }
.tabs button { flex-grow: 1; background: #333; border: 1px solid var(--border-color); color: var(--faint-color); padding: 10px 15px; cursor: pointer; border-radius: 4px; font-size: 1em; }
.tabs button.active { background: var(--accent-color); color: white; border-color: var(--accent-color); }
.session-grid { display: grid; grid-template-columns: 1fr; grid-template-rows: auto; gap: 1rem; }
@media (min-width: 1000px) { .session-grid { grid-template-columns: 3fr 2fr; grid-template-areas: "context context" "journey interaction"; } .context-view { grid-area: context; } .journey-view { grid-area: journey; } .interaction-view { grid-area: interaction; } }
.related-concept { display: inline-block; background: #333; padding: 2px 8px; border-radius: 4px; margin: 2px; font-size: 0.9em; border: 1px solid #333; }
.thesis-content { font-style: italic; border-left: 3px solid var(--accent-color); padding-left: 1rem; margin-bottom: 1rem; }
.thesis-content p:first-child, .content-view p:first-child { margin-top: 0; }
.thesis-content p:last-child, .content-view p:last-child { margin-bottom: 0; }
.evidence-list { list-style: none; padding: 0; margin: 0; }
.evidence-list li { padding: 0.5rem; border-radius: 4px; }
.evidence-list li.active { background-color: #3c3c3c; } .evidence-list .icon { display: inline-block; width: 1.5em; font-weight: bold; }
.progress-bar { color: var(--faint-color); font-size: 0.9em; text-align: right; margin-top: 1rem; }
.prompt { font-size: 1.1em; margin-bottom: 1rem; background-color: #111; padding: 0.75rem; border-radius: 4px; }
.answer-area { min-height: 120px; background-color: #202020; padding: 1rem; border-radius: 4px; margin-bottom: 1rem; }
.relation-tagging { padding: 1rem; display: flex; justify-content: center; gap: 1rem; flex-wrap: wrap; }
.relation-tagging .relation-label { align-self: center; color: var(--faint-color); }
.content-view .katex-display { margin: 1em 0; }
.content-view .card-image { max-width: 100%; height: auto; border-radius: 4px; margin: 0.5em 0; }
button { background: #3c3c3c; border: 1px solid #555; color: var(--text-color); padding: 10px 15px; cursor: pointer; border-radius: 4px; transition: background-color 0.2s; }
button:hover { background: #4f4f4f; }
.controls { text-align: center; }
.menu-item { display: flex; justify-content: space-between; align-items: center; padding: 1rem; border-bottom: 1px solid var(--border-color); cursor: pointer; }
.menu-item:hover { background-color: #333; } .menu-item:last-child { border-bottom: none; }
.menu-item div:last-child { display: flex; gap: 0.5rem; }
.menu-item button { background-color: var(--accent-color); border: none; color: white; pointer-events: all; }
.add-card-grid { display: grid; grid-template-columns: 1fr; gap: 1rem; }
@media (min-width: 800px) { .add-card-grid { grid-template-columns: 1fr 1fr; } }
.add-card-form { display: flex; flex-direction: column; }
.add-card-form input, .add-card-form textarea { background: #333; border: 1px solid #555; color: var(--text-color); padding: 10px; margin-bottom: 1rem; border-radius: 4px; font-family: inherit; font-size: 1em; }
.add-card-form textarea { min-height: 200px; resize: vertical; }
.add-card-form label { margin-bottom: 0.5rem; color: var(--faint-color); }
.content-preview { font-size: 1.1em; word-wrap: break-word; }
.status.success { color: var(--correct-color); } .status.error { color: var(--incorrect-color); }
        `;
    }
}

new BeautifulMindApp('#app-container');