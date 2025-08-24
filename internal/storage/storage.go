package storage

import (
	"beautifulmind/internal/deck"
	"beautifulmind/internal/embedding"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

type DB struct{ *sql.DB }

type DBCard struct {
	deck.Card
	DeckID      string
	DueDate     time.Time
	Interval    float64
	EaseFactor  float64
	Repetitions int
}

type DBConcept struct {
	deck.Concept
	Embedding []float32
}

func InitializeDB(dataSourceName string) (*DB, error) {
	db, err := sql.Open("sqlite3", dataSourceName)
	if err != nil { return nil, err }

	schema := `
	CREATE TABLE IF NOT EXISTS concepts (
		id TEXT PRIMARY KEY, name TEXT, description TEXT, embedding TEXT
	);
	CREATE TABLE IF NOT EXISTS cards (
		id TEXT PRIMARY KEY, deck_id TEXT, concept_id TEXT, card_type TEXT, title TEXT, content TEXT,
		due_date DATETIME, interval REAL, ease_factor REAL, repetitions INTEGER
	);
	CREATE TABLE IF NOT EXISTS correlations (
		source_concept_id TEXT NOT NULL,
		target_concept_id TEXT NOT NULL,
		similarity REAL NOT NULL,
		PRIMARY KEY (source_concept_id, target_concept_id)
	);`

	if _, err := db.Exec(schema); err != nil { return nil, fmt.Errorf("failed to create schema: %w", err) }
	return &DB{db}, nil
}

func (db *DB) SyncKnowledgeGraph(decks []*deck.Deck) error {
	tx, err := db.Begin()
	if err != nil { return err }
	defer tx.Rollback()

	conceptStmt, err := tx.Prepare(`INSERT INTO concepts (id, name, description, embedding) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description`)
	if err != nil { return err }
	defer conceptStmt.Close()

	cardStmt, err := tx.Prepare(`
		INSERT INTO cards (id, deck_id, concept_id, card_type, title, content, due_date, interval, ease_factor, repetitions) 
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) 
		ON CONFLICT(id) DO UPDATE SET 
			title=excluded.title, 
			content=excluded.content, 
			deck_id=excluded.deck_id, 
			concept_id=excluded.concept_id`)
	if err != nil { return err }
	defer cardStmt.Close()

	for _, d := range decks {
		for _, concept := range d.Concepts {
			emb := embedding.GenerateEmbedding(concept.Name + ": " + concept.Description)
			embJSON, _ := json.Marshal(emb)
			if _, err := conceptStmt.Exec(concept.ID, concept.Name, concept.Description, string(embJSON)); err != nil { return err }
		}
		for _, card := range d.Cards {
			if _, err := cardStmt.Exec(card.ID, d.DeckID, card.ConceptID, card.CardType, card.Title, card.Content, time.Now(), 0.0, 2.5, 0); err != nil { return err }
		}
	}
	return tx.Commit()
}

// adds a single new card to the database.
func (db *DB) AddCard(card DBCard) error {
	_, err := db.Exec(
		`INSERT INTO cards (id, deck_id, concept_id, card_type, title, content, due_date, interval, ease_factor, repetitions) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		card.ID, card.DeckID, card.ConceptID, card.CardType, card.Title, card.Content, time.Now(), 0.0, 2.5, 0,
	)
	return err
}

func (db *DB) UpdateCorrelations(concepts []*DBConcept) error {
	tx, err := db.Begin()
	if err != nil { return err }
	defer tx.Rollback()

	if _, err := tx.Exec("DELETE FROM correlations"); err != nil { return err }

	stmt, err := tx.Prepare("INSERT INTO correlations (source_concept_id, target_concept_id, similarity) VALUES (?, ?, ?)")
	if err != nil { return err }
	defer stmt.Close()

	for i := 0; i < len(concepts); i++ {
		for j := i + 1; j < len(concepts); j++ {
			c1, c2 := concepts[i], concepts[j]
			sim := embedding.CosineSimilarity(c1.Embedding, c2.Embedding)
			if sim > 0 { // don't store zero similarity
				if _, err := stmt.Exec(c1.ID, c2.ID, sim); err != nil { return err }
				if _, err := stmt.Exec(c2.ID, c1.ID, sim); err != nil { return err }
			}
		}
	}
	return tx.Commit()
}

func (db *DB) GetCorrelationsForConcept(conceptID string) ([]struct{Name string; Sim float32}, error) {
	rows, err := db.Query(`
		SELECT c.name, co.similarity
		FROM correlations co
		JOIN concepts c ON c.id = co.target_concept_id
		WHERE co.source_concept_id = ?
		ORDER BY co.similarity DESC
		LIMIT 5
	`, conceptID)
	if err != nil { return nil, err }
	defer rows.Close()

	var results []struct{Name string; Sim float32}
	for rows.Next() {
		var res struct{Name string; Sim float32}
		if err := rows.Scan(&res.Name, &res.Sim); err != nil { return nil, err }
		results = append(results, res)
	}
	return results, nil
}

func (db *DB) GetCard(cardID string) (*DBCard, error) {
	row := db.QueryRow(`SELECT id, deck_id, concept_id, card_type, title, content, due_date, interval, ease_factor, repetitions FROM cards WHERE id = ?`, cardID)
	var c DBCard
	var dueDate sql.NullString
	err := row.Scan(&c.ID, &c.DeckID, &c.ConceptID, &c.CardType, &c.Title, &c.Content, &dueDate, &c.Interval, &c.EaseFactor, &c.Repetitions)
	if err != nil { return nil, err }
	if dueDate.Valid {
		parsedTime, err := time.Parse("2006-01-02 15:04:05.999999999-07:00", dueDate.String)
		if err != nil { parsedTime, _ = time.Parse(time.RFC3339, dueDate.String) }
		c.DueDate = parsedTime
	}
	return &c, nil
}

func (db *DB) UpdateCardSRS(cardID string, dueDate time.Time, interval, easeFactor float64, repetitions int) error {
	_, err := db.Exec(`UPDATE cards SET due_date = ?, interval = ?, ease_factor = ?, repetitions = ? WHERE id = ?`, dueDate, interval, easeFactor, repetitions, cardID)
	return err
}

func (db *DB) GetAllConceptsWithEmbeddings() ([]*DBConcept, error) {
	rows, err := db.Query(`SELECT id, name, description, embedding FROM concepts`)
	if err != nil { return nil, err }
	defer rows.Close()
	var concepts []*DBConcept
	for rows.Next() {
		var c DBConcept
		var embJSON string
		if err := rows.Scan(&c.ID, &c.Name, &c.Description, &embJSON); err != nil { return nil, err }
		json.Unmarshal([]byte(embJSON), &c.Embedding)
		concepts = append(concepts, &c)
	}
	return concepts, nil
}

func (db *DB) GetAllCards() ([]*DBCard, error) {
	rows, err := db.Query(`SELECT id, deck_id, concept_id, card_type, title, content, due_date, interval, ease_factor, repetitions FROM cards`)
	if err != nil { return nil, err }
	defer rows.Close()
	var cards []*DBCard
	for rows.Next() {
		var c DBCard
		var dueDate sql.NullString
		if err := rows.Scan(&c.ID, &c.DeckID, &c.ConceptID, &c.CardType, &c.Title, &c.Content, &dueDate, &c.Interval, &c.EaseFactor, &c.Repetitions); err != nil {
			return nil, err
		}
		if dueDate.Valid {
			parsedTime, err := time.Parse("2006-01-02 15:04:05.999999999-07:00", dueDate.String)
			if err != nil { parsedTime, _ = time.Parse(time.RFC3339, dueDate.String) }
			c.DueDate = parsedTime
		}
		cards = append(cards, &c)
	}
	return cards, nil
}