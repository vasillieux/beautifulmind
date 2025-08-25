import { DB, Card, Concept, Correlation } from './db';

type Link = { source: string; target: string; type: string };

export class SynapseSession {
    private db: DB;
    private links: Link[];
    public thesis: Card;
    public evidenceDeck: Card[];
    public currentStep: number;
    public isEvidenceRevealed: boolean;
    public isInfinite: boolean;
    private visitedCardIds: Set<string>;
    public sprintTotal: number;
    public sprintCompleted: number;

    constructor(db: DB, decksDir: string, thesisId: string, isInfinite: boolean) {
        this.db = db;
        this.links = this.db.getLinks(decksDir);
        this.thesis = this.db.getCard(thesisId)!;
        this.isInfinite = isInfinite;
        this.currentStep = 0;
        this.isEvidenceRevealed = false;
        
        this.evidenceDeck = this.links
            .filter(link => link.target === this.thesis.id)
            .map(link => this.db.getCard(link.source))
            .filter((card): card is Card => card !== null && new Date(card.due_date) <= new Date());
        
        this.visitedCardIds = new Set(this.evidenceDeck.map(c => c.id));
        this.visitedCardIds.add(this.thesis.id);
        
        this.sprintTotal = this.evidenceDeck.length;
        this.sprintCompleted = 0;

        for (let i = this.evidenceDeck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.evidenceDeck[i], this.evidenceDeck[j]] = [this.evidenceDeck[j], this.evidenceDeck[i]];
        }
    }

    public processInput(key: string) {
        const card = this.getCurrentCard();
        if (!card) return;

        const isReasoningCard = this.links.some(l => l.source === card.id && l.target === this.thesis.id);

        if (!this.isEvidenceRevealed) {
            if (key === 'enter') {
                this.isEvidenceRevealed = true;
                if (!isReasoningCard) this.updateSRS(card, 3);
            }
        } else {
            let advance = false;
            if (isReasoningCard) {
                let choice: string | null = null;
                if (key === 'up') choice = 'SUPPORTS';
                if (key === 'down') choice = 'REFUTES';
                
                if (choice) {
                    const link = this.links.find(l => l.source === card.id && l.target === this.thesis.id);
                    const isCorrect = choice === link?.type;
                    this.updateSRS(card, isCorrect ? 4 : 1);
                    advance = true;
                }
            } else {
                if (key === 'enter') {
                    advance = true;
                }
            }
            if (advance) {
                if(this.currentStep < this.sprintTotal) this.sprintCompleted++;
                this.advance();
            }
        }
    }
    
    private advance() {
        this.currentStep++;
        this.isEvidenceRevealed = false;
        if (this.currentStep >= this.evidenceDeck.length && this.isInfinite) {
            this.extendJourney();
        }
    }

    private extendJourney() {
        const lastCard = this.evidenceDeck[this.evidenceDeck.length - 1];
        if (!lastCard) return;

        const correlations = this.db.getCorrelationsForConcept(lastCard.concept_id);
        
        for (const corr of correlations) {
            const nextCard = this.db.getNextCardForConcept(corr.id, Array.from(this.visitedCardIds));
            if (nextCard) {
                this.evidenceDeck.push(nextCard);
                this.visitedCardIds.add(nextCard.id);
                return;
            }
        }
    }

    public getCurrentCard(): Card | null {
        return this.evidenceDeck[this.currentStep] || null;
    }
    
    private updateSRS(card: Card, quality: number) {
        let { repetitions, interval, ease_factor } = card;

        if (quality < 3) {
            repetitions = 0;
            interval = 1;
        } else {
            repetitions++;
            if (repetitions === 1) interval = 1;
            else if (repetitions === 2) interval = 6;
            else interval = Math.ceil(interval * ease_factor);
        }

        ease_factor = ease_factor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
        if (ease_factor < 1.3) ease_factor = 1.3;

        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + interval);
        
        this.db.updateCardSRS(card.id, {
            dueDate: dueDate.toISOString(),
            interval,
            easeFactor: ease_factor,
            repetitions,
        });
    }

    public getState() {
        return {
            thesis: this.thesis,
            evidenceDeck: this.evidenceDeck,
            currentStep: this.currentStep,
            isEvidenceRevealed: this.isEvidenceRevealed,
            currentCard: this.getCurrentCard(),
            sprintTotal: this.sprintTotal,
            sprintCompleted: this.sprintCompleted
        };
    }
}