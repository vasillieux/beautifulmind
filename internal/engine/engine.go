package engine

import (
	"beautifulmind/internal/deck"
	"beautifulmind/internal/embedding"
	"beautifulmind/internal/storage"
	"math"
	"math/rand"
	"sort"
	"time"
)

type KnowledgeGraph struct {
	Concepts map[string]*storage.DBConcept
	Cards    map[string]*storage.DBCard
	Links    []deck.Link
	Decks    []*deck.Deck
}

type JourneyStep struct {
	Card              *storage.DBCard
	AnsweredCorrectly bool
}

type SynapseSession struct {
	DB               *storage.DB
	Graph            *KnowledgeGraph
	Thesis           *storage.DBCard
	EvidenceDeck     []*storage.DBCard
	CurrentStep      int
	JourneyLog       []JourneyStep
	Score            int
	IsEvidenceRevealed bool
}

func LoadKnowledgeGraph(db *storage.DB, decks []*deck.Deck) (*KnowledgeGraph, error) {
	concepts, err := db.GetAllConceptsWithEmbeddings()
	if err != nil { return nil, err }

	allCards, err := db.GetAllCards()
	if err != nil { return nil, err }

	graph := &KnowledgeGraph{
		Concepts: make(map[string]*storage.DBConcept),
		Cards:    make(map[string]*storage.DBCard),
		Decks:    decks,
	}

	for _, c := range concepts { graph.Concepts[c.ID] = c }
	for _, c := range allCards { graph.Cards[c.ID] = c }
	for _, d := range decks { graph.Links = append(graph.Links, d.Links...) }

	return graph, nil
}

func (kg *KnowledgeGraph) NewSynapseSession(db *storage.DB, thesisCardID string) *SynapseSession {
	thesis := kg.Cards[thesisCardID]
	var evidenceDeck []*storage.DBCard
	for _, link := range kg.Links {
		if link.Target == thesis.ID {
			evidenceDeck = append(evidenceDeck, kg.Cards[link.Source])
		}
	}
	
	rand.Seed(time.Now().UnixNano())
	rand.Shuffle(len(evidenceDeck), func(i, j int) { evidenceDeck[i], evidenceDeck[j] = evidenceDeck[j], evidenceDeck[i] })

	return &SynapseSession{
		DB:           db,
		Graph:        kg,
		Thesis:       thesis,
		EvidenceDeck: evidenceDeck,
	}
}

func (s *SynapseSession) ProcessInput(key string) {
	card := s.CurrentCard()
	if card == nil { return }
	
	isReasoningCard := s.CurrentCardIsReasoning()

	if !s.IsEvidenceRevealed {
		if key == "enter" {
			s.IsEvidenceRevealed = true
			// if it's just a remembering card, we auto-grade it here
			if !isReasoningCard {
				s.updateSRS(card, 3) // grade 'good' just for revealing
			}
		}
	} else {
		if isReasoningCard {
			// handle reasoning answer
			choice := deck.LinkType("")
			if key == "up" { choice = deck.SUPPORTS }
			if key == "down" { choice = deck.REFUTES }
			
			if choice != "" {
				correctChoice := s.getCorrectLinkType()
				isCorrect := choice == correctChoice
				
				var quality int
				if isCorrect { s.Score += 100; quality = 4 } else { quality = 1 } // easy or hard
				
				s.JourneyLog = append(s.JourneyLog, JourneyStep{Card: card, AnsweredCorrectly: isCorrect})
				s.updateSRS(card, quality)
				s.advance()
			}
		} else {
			// handle remembering card advance
			if key == "enter" {
				// already graded on reveal, so just log and advance
				s.JourneyLog = append(s.JourneyLog, JourneyStep{Card: card, AnsweredCorrectly: true})
				s.advance()
			}
		}
	}
}

// helper to advance to the next card
func (s *SynapseSession) advance() {
	s.CurrentStep++
	s.IsEvidenceRevealed = false
}

func (s *SynapseSession) CurrentCard() *storage.DBCard {
	if s.CurrentStep >= len(s.EvidenceDeck) { return nil }
	return s.EvidenceDeck[s.CurrentStep]
}

// the magic function: dynamically checks what kind of card we're on
func (s *SynapseSession) CurrentCardIsReasoning() bool {
	return s.getCorrectLinkType() != ""
}

func (s *SynapseSession) getCorrectLinkType() deck.LinkType {
	card := s.CurrentCard()
	if card == nil { return "" }
	for _, link := range s.Graph.Links {
		if link.Source == card.ID && link.Target == s.Thesis.ID {
			// only supports and refutes are reasoning tasks in this context
			if link.Type == deck.SUPPORTS || link.Type == deck.REFUTES {
				return link.Type
			}
		}
	}
	return ""
}

func (s *SynapseSession) updateSRS(card *storage.DBCard, quality int) {
	dbCard, err := s.DB.GetCard(card.ID)
	if err != nil { return }

	if quality < 3 {
		dbCard.Repetitions = 0; dbCard.Interval = 1
	} else {
		dbCard.Repetitions++
		if dbCard.Repetitions == 1 { dbCard.Interval = 1 } else if dbCard.Repetitions == 2 { dbCard.Interval = 6 } else {
			dbCard.Interval = math.Ceil(dbCard.Interval * dbCard.EaseFactor)
		}
	}
	if quality >= 3 {
		dbCard.EaseFactor += (0.1 - (5-float64(quality))*(0.08+(5-float64(quality))*0.02))
		if dbCard.EaseFactor < 1.3 { dbCard.EaseFactor = 1.3 }
	}

	duration := time.Duration(dbCard.Interval*24) * time.Hour
	dbCard.DueDate = time.Now().Add(duration)

	s.DB.UpdateCardSRS(dbCard.ID, dbCard.DueDate, dbCard.Interval, dbCard.EaseFactor, dbCard.Repetitions)
}

func (s *SynapseSession) GetRelatedConcepts() []string {
	card := s.CurrentCard()
	if card == nil { return nil }

	currentConcept := s.Graph.Concepts[card.ConceptID]
	type conceptSimilarity struct{ Name string; Sim float32 }
	var similarities []conceptSimilarity
	
	for _, otherConcept := range s.Graph.Concepts {
		if otherConcept.ID != currentConcept.ID {
			sim := embedding.CosineSimilarity(currentConcept.Embedding, otherConcept.Embedding)
			if sim > 0.1 {
				similarities = append(similarities, conceptSimilarity{Name: otherConcept.Name, Sim: sim})
			}
		}
	}
	sort.Slice(similarities, func(i, j int) bool { return similarities[i].Sim > similarities[j].Sim })

	var relatedNames []string
	for i, sim := range similarities {
		if i >= 4 { break }
		relatedNames = append(relatedNames, sim.Name)
	}
	return relatedNames
}