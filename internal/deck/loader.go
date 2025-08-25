package deck

import (
	"fmt"
	"io/ioutil"
	"path/filepath"

	"gopkg.in/yaml.v2"
)
type LinkType string
const (SUPPORTS LinkType = "SUPPORTS"; REFUTES LinkType = "REFUTES"; REQUIRES LinkType = "REQUIRES"; IMPLIES LinkType = "IMPLIES")
type CardType string
const (Thesis CardType = "Thesis"; Evidence CardType = "Evidence")
type Concept struct { ID string `yaml:"id"`; Name string `yaml:"name"`; Description string `yaml:"description"` }
type Card struct { ID string `yaml:"id"`; ConceptID string `yaml:"concept_id"`; CardType CardType `yaml:"card_type"`; Title string `yaml:"title"`; Content string `yaml:"content"` }
type Link struct { Source string `yaml:"source"`; Target string `yaml:"target"`; Type LinkType `yaml:"type"` }
type Deck struct { DeckName string `yaml:"deckName"`; DeckID string `yaml:"deckID"`; Concepts []Concept `yaml:"concepts"`; Cards []*Card `yaml:"cards"`; Links []Link `yaml:"links"`; CardMap map[string]*Card; ConceptMap map[string]*Concept }
func LoadDeckFromFile(filePath string) (*Deck, error) {
	data, err := ioutil.ReadFile(filepath.Clean(filePath)); if err != nil { return nil, fmt.Errorf("failed to read deck file: %w", err) }
	var d Deck; if err := yaml.Unmarshal(data, &d); err != nil { return nil, fmt.Errorf("failed to unmarshal deck YAML: %w", err) }
	d.buildMaps(); return &d, nil
}
func (d *Deck) buildMaps() {
	d.CardMap = make(map[string]*Card); for _, card := range d.Cards { d.CardMap[card.ID] = card }
	d.ConceptMap = make(map[string]*Concept); for i := range d.Concepts { d.ConceptMap[d.Concepts[i].ID] = &d.Concepts[i] }
}