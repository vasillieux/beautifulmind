import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { sha1 } from 'tiny-hashes';

export type Card = {
    id: string;
    deck_id: string;
    concept_id: string;
    title: string;
    content: string;
    card_type: string;
    due_date: string;
    interval: number;
    ease_factor: number;
    repetitions: number;
};
export type Concept = { id: string; name: string; description: string; embedding: number[]; };
export type Correlation = { name: string; similarity: number; };

export class DB {
    public db: Database.Database;

    constructor(path: string) {
        this.db = new Database(path);
        this.init();
    }

    private init() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS concepts (id TEXT PRIMARY KEY, name TEXT, description TEXT, embedding TEXT);
            CREATE TABLE IF NOT EXISTS cards (
                id TEXT PRIMARY KEY, deck_id TEXT, concept_id TEXT, title TEXT, content TEXT,
                card_type TEXT, due_date TEXT, interval REAL, ease_factor REAL, repetitions INTEGER
            );
            CREATE TABLE IF NOT EXISTS correlations (source_id TEXT, target_id TEXT, similarity REAL, PRIMARY KEY (source_id, target_id));
        `);
    }
    
    private generateEmbedding(text: string): number[] {
        const hash = sha1(text);
        const seed = parseInt(hash.substring(0, 15), 16);
        const random = () => {
            const x = Math.sin(seed) * 10000;
            return x - Math.floor(x);
        };
        let norm = 0;
        const embedding = Array.from({ length: 4 }, () => {
            const val = random() * 2 - 1;
            norm += val * val;
            return val;
        });
        norm = Math.sqrt(norm);
        return embedding.map(v => v / norm);
    }
    
    private cosineSimilarity(a: number[], b: number[]): number {
        let dotProduct = 0;
        for (let i = 0; i < a.length; i++) {
            dotProduct += a[i] * b[i];
        }
        return dotProduct;
    }

    public syncDecks(decksDir: string) {
        const conceptsToInsert: any[] = [];
        const cardsToInsert: any[] = [];
        const files = fs.readdirSync(decksDir);

        for (const file of files) {
            if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue;
            
            const content = fs.readFileSync(path.join(decksDir, file), 'utf8');
            const deck = yaml.load(content) as any;
            if (!deck || !deck.concepts || !deck.cards) continue;

            for (const concept of deck.concepts) {
                conceptsToInsert.push({
                    ...concept,
                    embedding: JSON.stringify(this.generateEmbedding(`${concept.name}: ${concept.description}`))
                });
            }

            for (const card of deck.cards) {
                const cardId = sha1(`${card.title}:${card.content}`);
                cardsToInsert.push({
                    id: cardId,
                    deck_id: deck.deckID,
                    concept_id: card.concept_id,
                    title: card.title,
                    content: card.content,
                    card_type: card.card_type || 'Definition'
                });
            }
        }
        
        const insertConcept = this.db.prepare(`INSERT INTO concepts (id, name, description, embedding) VALUES (@id, @name, @description, @embedding) ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description`);
        const insertCard = this.db.prepare(`INSERT INTO cards (id, deck_id, concept_id, title, content, card_type, due_date, interval, ease_factor, repetitions) VALUES (@id, @deck_id, @concept_id, @title, @content, @card_type, @due_date, @interval, @ease_factor, @repetitions) ON CONFLICT(id) DO NOTHING`);
        
        const syncTransaction = this.db.transaction(() => {
            for (const concept of conceptsToInsert) insertConcept.run(concept);
            for (const card of cardsToInsert) {
                insertCard.run({
                    ...card,
                    due_date: new Date(0).toISOString(),
                    interval: 0,
                    ease_factor: 2.5,
                    repetitions: 0,
                });
            }
        });

        syncTransaction();
        this.updateCorrelations();
    }

    private updateCorrelations() {
        const concepts: Concept[] = this.db.prepare('SELECT id, embedding FROM concepts').all().map((c: any) => ({ ...c, embedding: JSON.parse(c.embedding) }));
        const insertCorrelation = this.db.prepare('INSERT INTO correlations (source_id, target_id, similarity) VALUES (?, ?, ?)');
        const correlationTransaction = this.db.transaction(() => {
            this.db.exec('DELETE FROM correlations');
            for (let i = 0; i < concepts.length; i++) {
                for (let j = i + 1; j < concepts.length; j++) {
                    const c1 = concepts[i];
                    const c2 = concepts[j];
                    const sim = this.cosineSimilarity(c1.embedding, c2.embedding);
                    if (sim > 0.1) {
                        insertCorrelation.run(c1.id, c2.id, sim);
                        insertCorrelation.run(c2.id, c1.id, sim);
                    }
                }
            }
        });
        correlationTransaction();
    }
    
    public getCard(id: string): Card | null {
        return this.db.prepare('SELECT * FROM cards WHERE id = ?').get(id) as Card || null;
    }

    public getTheses(): Card[] {
        return this.db.prepare("SELECT * FROM cards WHERE card_type = 'Thesis'").all() as Card[];
    }
    
    public getLinks(decksDir: string): any[] {
        const allLinks: any[] = [];
        const files = fs.readdirSync(decksDir);
        for (const file of files) {
            if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue;
            const content = fs.readFileSync(path.join(decksDir, file), 'utf8');
            const deck = yaml.load(content) as any;
            if (deck && deck.links) {
                deck.links.forEach((link: any) => {
                    const sourceCard = (deck.cards as any[]).find(c => c.id === link.source);
                    const targetCard = (deck.cards as any[]).find(c => c.id === link.target);
                    if (sourceCard && targetCard) {
                        allLinks.push({
                            source: sha1(`${sourceCard.title}:${sourceCard.content}`),
                            target: sha1(`${targetCard.title}:${targetCard.content}`),
                            type: link.type
                        });
                    }
                });
            }
        }
        return allLinks;
    }
    
    public getNextCardForConcept(conceptId: string, excludedIds: string[]): Card | null {
        if (excludedIds.length === 0) {
             return this.db.prepare("SELECT * FROM cards WHERE concept_id = ? AND due_date <= datetime('now') ORDER BY RANDOM() LIMIT 1").get(conceptId) as Card || null;
        }
        const placeholders = excludedIds.map(() => '?').join(',');
        const params = [conceptId, ...excludedIds];
        const sql = `SELECT * FROM cards WHERE concept_id = ? AND id NOT IN (${placeholders}) AND due_date <= datetime('now') ORDER BY RANDOM() LIMIT 1`;
        return this.db.prepare(sql).get(...params) as Card || null;
    }

    public addCard(data: { title: string, content: string, deckId?: string, conceptId?: string }): Card {
        const cardId = sha1(`${data.title}:${data.content}`);
        const conceptId = data.conceptId || `concept_${sha1(data.title)}`;
        
        const embedding = this.generateEmbedding(`${data.title}: ${data.content}`);
        this.db.prepare(`INSERT INTO concepts (id, name, description, embedding) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`)
            .run(conceptId, data.title, data.content, JSON.stringify(embedding));

        this.db.prepare(`INSERT INTO cards (id, deck_id, concept_id, title, content, card_type, due_date, interval, ease_factor, repetitions) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`)
            .run(cardId, data.deckId || 'custom', conceptId, data.title, data.content, 'Definition', new Date(0).toISOString(), 0, 2.5, 0);
            
        this.updateCorrelations();
        return this.getCard(cardId)!;
    }

    public updateCardSRS(id: string, srs: { dueDate: string, interval: number, easeFactor: number, repetitions: number }) {
        this.db.prepare('UPDATE cards SET due_date = @dueDate, interval = @interval, ease_factor = @easeFactor, repetitions = @repetitions WHERE id = @id').run({ id, ...srs });
    }

    public getCorrelationsForConcept(conceptId: string): Correlation[] {
        return this.db.prepare(`
            SELECT c.name, co.similarity, c.id
            FROM correlations co
            JOIN concepts c ON c.id = co.target_id
            WHERE co.source_id = ?
            ORDER BY co.similarity DESC
            LIMIT 5
        `).all(conceptId) as (Correlation & { id: string })[];
    }
}