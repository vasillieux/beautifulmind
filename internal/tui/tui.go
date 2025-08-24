package tui

import (
	"beautifulmind/internal/deck"
	"beautifulmind/internal/engine"
	"beautifulmind/internal/storage"
	"fmt"
	"strings"

	"github.com/charmbracelet/bubbles/list"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

// -- styles --
var (
	docStyle           = lipgloss.NewStyle().Margin(1, 2)
	helpStyle          = lipgloss.NewStyle().Faint(true)
	faintStyle         = lipgloss.NewStyle().Faint(true)
	boldStyle          = lipgloss.NewStyle().Bold(true)
	activeStyle        = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("63"))
	correctStyle       = lipgloss.NewStyle().Foreground(lipgloss.Color("46"))
	incorrectStyle     = lipgloss.NewStyle().Foreground(lipgloss.Color("196"))
	panelStyle         = lipgloss.NewStyle().Padding(1, 2).Border(lipgloss.RoundedBorder()).BorderForeground(lipgloss.Color("240"))
)

type viewState int
const (
	menuView viewState = iota
	gameView
)

type menuItem struct {
	title, desc, id string
}
func (i menuItem) Title() string       { return i.title }
func (i menuItem) Description() string { return i.desc }
func (i menuItem) FilterValue() string { return i.title }

type model struct {
	db       *storage.DB
	kg       *engine.KnowledgeGraph
	state    viewState
	session  *engine.SynapseSession
	menu     list.Model
	width, height int
}

func InitialModel(db *storage.DB, kg *engine.KnowledgeGraph) model {
	m := model{db: db, kg: kg, state: menuView}
	m.setMainMenu()
	return m
}

func (m model) Init() tea.Cmd { return nil }

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width, m.height = msg.Width, msg.Height
		m.menu.SetSize(msg.Width, msg.Height)
	case tea.KeyMsg:
		if msg.String() == "ctrl+c" { return m, tea.Quit }
		if msg.String() == "b" {
			if m.state != menuView {
				m.setMainMenu()
				m.state = menuView
				return m, nil
			}
		}
		switch m.state {
		case menuView:
			return m.updateMenu(msg)
		case gameView:
			m.session.ProcessInput(msg.String())
			return m, nil
		}
	}
	return m, nil
}

func (m model) View() string {
	if m.width == 0 { return "loading..." }
	switch m.state {
	case menuView:
		return docStyle.Render(m.menu.View())
	case gameView:
		return m.viewSynapse()
	}
	return "error"
}

func Start(db *storage.DB, kg *engine.KnowledgeGraph) error {
	p := tea.NewProgram(InitialModel(db, kg), tea.WithAltScreen())
	return p.Start()
}

func (m *model) setMainMenu() {
	items := []list.Item{}
	for _, card := range m.kg.Cards {
		if card.CardType == deck.Thesis {
			items = append(items, menuItem{title: card.Title, desc: fmt.Sprintf("start a synapse session from '%s'", card.DeckID), id: card.ID})
		}
	}
	l := list.New(items, list.NewDefaultDelegate(), 0, 0)
	l.Title = "Select a Thesis to Begin"
	l.Styles.Title = activeStyle
	m.menu = l
}

func (m *model) updateMenu(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	if msg.String() == "enter" {
		item := m.menu.SelectedItem().(menuItem)
		m.session = m.kg.NewSynapseSession(m.db, item.id)
		m.state = gameView
		return m, nil
	}
	var cmd tea.Cmd
	m.menu, cmd = m.menu.Update(msg)
	return m, cmd
}


func (m model) viewSynapse() string {
	if m.session == nil || m.session.CurrentCard() == nil {
		return docStyle.Render(fmt.Sprintf("Session complete! Score: %d\n\n(b)ack to menu", m.session.Score))
	}

	context := m.renderContextView()
	journey := m.renderJourneyView()
	interaction, help := m.renderInteractionView()

	leftPanel := journey
	rightPanel := lipgloss.JoinVertical(lipgloss.Left, interaction, helpStyle.Render(help))
	
	mainLayout := lipgloss.JoinVertical(lipgloss.Left,
		context,
		lipgloss.JoinHorizontal(lipgloss.Top, leftPanel, rightPanel),
	)
	return docStyle.Render(mainLayout)
}

func (m model) renderContextView() string {
	related := m.session.GetRelatedConcepts()
	mainText := "CONTEXT\n\n" + boldStyle.Render(m.session.Graph.Concepts[m.session.CurrentCard().ConceptID].Name)
	relatedText := "\n" + faintStyle.Render("Related: " + strings.Join(related, ", "))
	return panelStyle.Copy().Width(m.width - 6).Render(mainText + relatedText)
}

func (m model) renderJourneyView() string {
	var b strings.Builder
	b.WriteString("JOURNEY LOG\n\n")
	for _, step := range m.session.JourneyLog {
		icon := incorrectStyle.Render("✗")
		if step.AnsweredCorrectly {
			icon = correctStyle.Render("✓")
		}
		b.WriteString(fmt.Sprintf("%s %s\n", icon, step.Card.Title))
	}
	if len(m.session.JourneyLog) > 0 { b.WriteString("\n") }
	b.WriteString(activeStyle.Render(">> " + m.session.CurrentCard().Title))
	
	return panelStyle.Copy().Width(40).Height(20).Render(b.String())
}

func (m model) renderInteractionView() (string, string) {
	var content, help, main string
	card := m.session.CurrentCard()
	isReasoningCard := m.session.CurrentCardIsReasoning()
	
	thesis := faintStyle.Render("THESIS: " + m.session.Thesis.Content)

	if !m.session.IsEvidenceRevealed {
		// evidence is hidden
		main = boldStyle.Render("EVIDENCE: " + card.Title)
		content = faintStyle.Render("\n[ what is the content of this card? press enter to reveal ]")
		help = "(enter) reveal | (b)ack to menu"
	} else {
		// evidence is revealed
		main = boldStyle.Render("EVIDENCE: " + card.Title) + "\n\n" + card.Content
		if isReasoningCard {
			help = "(↑) supports | (↓) refutes"
		} else {
			help = "(enter) next card"
		}
	}

	fullContent := lipgloss.JoinVertical(lipgloss.Left, thesis, "\n", main, content)
	return panelStyle.Copy().Width(m.width - 55).Height(15).Render(fullContent), help
}