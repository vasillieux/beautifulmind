package grcpserver

import (
	"beautifulmind/internal/deck"
	"beautifulmind/internal/engine"
	"beautifulmind/internal/proto"
	"beautifulmind/internal/storage"
	"context"
	"fmt"
	"time"
)

type server struct {
	proto.UnimplementedBeautifulMindServer
	db *storage.DB
	kg *engine.KnowledgeGraph
	currentSession *engine.SynapseSession
}

func NewServer(db *storage.DB, kg *engine.KnowledgeGraph) *server {
	return &server{db: db, kg: kg}
}

func (s *server) ListTheses(ctx context.Context, in *proto.Empty) (*proto.ListThesesResponse, error) {
	var theses []*proto.Card
	for _, card := range s.kg.Cards {
		if card.CardType == deck.Thesis {
			theses = append(theses, toProtoCard(card))
		}
	}
	return &proto.ListThesesResponse{Theses: theses}, nil
}

func (s *server) StartSession(ctx context.Context, in *proto.StartSessionRequest) (*proto.SessionState, error) {
	s.currentSession = s.kg.NewSynapseSession(s.db, in.ThesisId)
	return toProtoSession(s.currentSession), nil
}

func (s *server) ProcessInput(ctx context.Context, in *proto.ProcessInputRequest) (*proto.SessionState, error) {
	if s.currentSession == nil {
		return nil, fmt.Errorf("no active session")
	}
	s.currentSession.ProcessInput(in.Key)
	return toProtoSession(s.currentSession), nil
}

func (s *server) AddCard(ctx context.Context, in *proto.AddCardRequest) (*proto.Card, error) {
	newCard := storage.DBCard{
		DeckID: "custom",
		Card: deck.Card{
			ID:        fmt.Sprintf("card_%d", time.Now().UnixNano()),
			ConceptID: in.ConceptId,
			Title:     in.Title,
			Content:   in.Content,
			CardType:  deck.Evidence,
		},
	}
	if err := s.db.AddCard(newCard); err != nil {
		return nil, err
	}
	return toProtoCard(&newCard), nil
}

func toProtoCard(c *storage.DBCard) *proto.Card {
	if c == nil { return nil }
	return &proto.Card{
		Id:        c.ID,
		DeckId:    c.DeckID,
		ConceptId: c.ConceptID,
		Title:     c.Title,
		Content:   c.Content,
	}
}

func toProtoSession(s *engine.SynapseSession) *proto.SessionState {
	if s == nil { return nil }

	var evidenceDeck []*proto.Card
	for _, card := range s.EvidenceDeck {
		evidenceDeck = append(evidenceDeck, toProtoCard(card))
	}

	var journeyLog []*proto.JourneyStep
	for _, step := range s.JourneyLog {
		journeyLog = append(journeyLog, &proto.JourneyStep{
			Card:              toProtoCard(step.Card),
			AnsweredCorrectly: step.AnsweredCorrectly,
		})
	}
	
	concepts := make(map[string]*proto.Concept)
	for id, c := range s.Graph.Concepts {
		concepts[id] = &proto.Concept{Id: c.ID, Name: c.Name}
	}

	return &proto.SessionState{
		Thesis:             toProtoCard(s.Thesis),
		EvidenceDeck:       evidenceDeck,
		CurrentStep:        int32(s.CurrentStep),
		JourneyLog:         journeyLog,
		IsEvidenceRevealed: s.IsEvidenceRevealed,
		CurrentCard:        toProtoCard(s.CurrentCard()),
		Concepts:           concepts,
	}
}