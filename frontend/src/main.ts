import { GrpcWebFetchTransport } from "@protobuf-ts/grpcweb-transport";
import { BeautifulMindClient } from "./lib/proto/beautiulmind.client";
import { Card, SessionState } from "./lib/proto/beautiulmind";

class BeautifulMindApp {
    private client: BeautifulMindClient;
    private rootEl: HTMLElement;

    private state = {
        activeTab: 'synapse' as 'synapse' | 'add' | 'stats',
        status: 'connecting' as 'connecting' | 'ready' | 'error',
        theses: [] as Card[],
        session: null as SessionState | null,
        addCardStatus: '',
    };

    constructor(rootElementSelector: string) {
        this.rootEl = document.querySelector(rootElementSelector)!;
        const transport = new GrpcWebFetchTransport({ baseUrl: "http://localhost:50051" });
        this.client = new BeautifulMindClient(transport);
        this.init();
    }

    async init() {
        try {
            const thesesRes = await this.client.listTheses({});
            this.state.theses = thesesRes.response.theses;
            this.state.status = 'ready';
        } catch (e) {
            console.error("failed to connect to backend", e);
            this.state.status = 'error';
        }
        this.render();
    }

    render() {
        let content = '';
        if (this.state.status === 'connecting') content = `<div class="panel"><h1>connecting to engine...</h1></div>`;
        else if (this.state.status === 'error') content = `<div class="panel error"><h1>connection error. is \`./beautifulmind serve\` running?</h1></div>`;
        else {
            switch (this.state.activeTab) {
                case 'synapse': content = this.renderSynapse(); break;
                case 'add': content = this.renderAddCard(); break;
                case 'stats': content = `<div class="panel"><h2>Statistics</h2><p>coming soon...</p></div>`; break;
            }
        }
        
        this.rootEl.innerHTML = `
            <nav class="tabs">
                <button data-tab="synapse" class="${this.state.activeTab === 'synapse' ? 'active' : ''}">Synapse</button>
                <button data-tab="add" class="${this.state.activeTab === 'add' ? 'active' : ''}">Add Card</button>
                <button data-tab="stats" class="${this.state.activeTab === 'stats' ? 'active' : ''}">Stats</button>
            </nav>
            <div class="content">${content}</div>
        `;
        this.attachEventListeners();
    }
    
    attachEventListeners() {
        this.rootEl.querySelector('.tabs')?.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            if (target.matches('button')) {
                this.state.activeTab = target.dataset.tab as any;
                this.state.session = null;
                this.render();
            }
        });
        
        this.rootEl.querySelector('.content')?.addEventListener('click', async (e) => {
            const target = e.target as HTMLElement;
            const action = target.dataset.action;
            const thesisId = (target.closest('.menu-item') as HTMLElement)?.dataset.id;

            if (thesisId) {
                const { response } = await this.client.startSession({ thesisId });
                this.state.session = response;
            } else if (action === 'reveal') {
                const { response } = await this.client.processInput({ key: 'enter' });
                this.state.session = response;
            } else if (action === 'supports') {
                const { response } = await this.client.processInput({ key: 'up' });
                this.state.session = response;
            } else if (action === 'refutes') {
                const { response } = await this.client.processInput({ key: 'down' });
                this.state.session = response;
            } else if (action === 'add-card') {
                await this.handleAddCard();
            }
            this.render();
        });
    }

    async handleAddCard() {
        const titleEl = document.getElementById('title-input') as HTMLInputElement;
        const contentEl = document.getElementById('content-input') as HTMLTextAreaElement;

        const title = titleEl.value;
        const content = contentEl.value;
        
        if (!title || !content) { this.state.addCardStatus = 'error'; this.render(); return; }

        try {
            await this.client.addCard({ title, content, conceptId: '' });
            this.state.addCardStatus = 'success';
            titleEl.value = '';
            contentEl.value = '';
        } catch(e) { this.state.addCardStatus = 'error'; }
        this.render();
    }

    renderSynapse(): string {
        if (!this.state.session) {
            return `
                <h2>Select a Thesis to Begin</h2>
                <div class="menu">
                    ${this.state.theses.map(thesis => `
                        <button class="menu-item" data-id="${thesis.id}">
                            <strong>${thesis.title}</strong>
                            <span class="faint">from deck '${thesis.deckId}'</span>
                        </button>
                    `).join('')}
                </div>
            `;
        }
        if (!this.state.session.currentCard) {
            return `<div class="panel">Journey complete!</div>`;
        }
        const s = this.state.session;
        const card = s.currentCard;
        let evidenceHTML = '';
        if (!s.isEvidenceRevealed) {
            evidenceHTML = `
                <h4>EVIDENCE: ${card.title}</h4>
                <p class="faint">[ what is the content of this card? ]</p>
                <button data-action="reveal">Reveal</button>
            `;
        } else {
            evidenceHTML = `
                <h4>EVIDENCE: ${card.title}</h4>
                <p>${card.content}</p>
                <div class="controls">
                    <button data-action="supports">Supports</button>
                    <button data-action="refutes">Refutes</button>
                </div>
            `;
        }
        return `<div class="panel">
            <p class="faint">THESIS: ${s.thesis?.content}</p>
            <hr/>
            ${evidenceHTML}
        </div>`;
    }

    renderAddCard(): string {
        let statusHTML = '';
        if (this.state.addCardStatus === 'success') statusHTML = `<p class="status success">card added.</p>`;
        if (this.state.addCardStatus === 'error') statusHTML = `<p class="status error">error adding card.</p>`;

        return `
            <h2>Add a New Card</h2>
            <div class="panel add-card-form">
                <label for="title">Title</label>
                <input type="text" id="title-input" placeholder="e.g., The Dot Product" />
                <label for="content">Content</label>
                <textarea id="content-input" placeholder="e.g., an operation..."></textarea>
                <button data-action="add-card">add card</button>
                ${statusHTML}
            </div>
        `;
    }
}

new BeautifulMindApp('#app-container');