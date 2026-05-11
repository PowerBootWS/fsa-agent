# fsa-agent Design Specification

**Date:** 2026-03-27
**Project:** fsa-agent (Full Steam Ahead Agent)
**Status:** Draft - Awaiting User Approval

---

## 1. Overview

fsa-agent is an iframe-embedded educational application for Power Engineers in Canada studying for certification advancement. The app provides an interactive learning experience with AI-powered tutoring, running securely within a parent domain's iframe.

### Key Characteristics
- Embedded in iframe on parent domain only
- Receives user email and lesson ID via iframe query parameters
- Fully custom AI agent system (not third-party AI API exposed)
- PostgreSQL backend for lesson data and progress tracking

---

## 2. Architecture

### System Components

```
┌─────────────────────────────────────────────────────────────────┐
│                        Parent Domain                             │
│  (iframe src="fsa-agent?user=email&lesson=id")                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Express API Server                           │
│  - Serves frontend                                              │
│  - Validates iframe query params                                │
│  - CORS restricted to parent domain                             │
│  - Secure proxy to Python AI service                            │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
┌─────────────────────────┐     ┌─────────────────────────────┐
│   Python AI Service     │     │      PostgreSQL             │
│   (Tutor + Orchestrator │     │   - Lessons                 │
│    + Researcher +       │     │   - User progress           │
│    Display Agent)       │     │   - Chat history            │
└─────────────────────────┘     └─────────────────────────────┘
```

### Technology Stack
- **Frontend:** React (via Express API serving)
- **Backend API:** Express.js (Node.js)
- **AI Service:** Python service
- **Database:** PostgreSQL (existing container)

---

## 3. Security Model

### Iframe Security
- App only loads in iframe on designated parent domain
- CORS headers restrict access to parent domain only
- Content Security Policy prevents embedding elsewhere

### Authentication Flow
1. Parent domain authenticates user
2. Parent domain loads iframe with query params: `?user={email}&lesson={lessonId}`
3. Express API validates params and creates session context
4. All subsequent requests include session context
5. No direct database access from frontend

### Data Protection
- PostgreSQL accessed only via backend API (never exposed to browser)
- Python AI service is internal-only, not publicly accessible
- User email and lesson ID validated on every request

---

## 4. User Interface

### Tab Structure

**Tab 1: Transcript**
- Displays full text transcript of lesson video
- Scrollable content
- Read-only display

**Tab 2: Interactive Lesson**
- **Top Section:** Displays summaries, snippets, or practice questions
  - Managed by Display Agent
  - Static content that updates based on conversation flow
- **Bottom Section:** Chat interface
  - Scrolling chat history
  - User input field
  - Tutor Agent interaction

### LaTeX Support
- KaTeX or MathJax for inline LaTeX rendering
- Lesson content stored with LaTeX markup
- Rendered in both transcript and chat contexts

---

## 5. Multi-Agent System

### Agent Overview

| Agent | Role |
|-------|------|
| Orchestrator | Monitors conversation flow, enforces constraints, directs other agents |
| Tutor Agent | Primary user interaction - conversation, feedback, guidance, active learning |
| Researcher | Queries PostgreSQL for lesson content, retrieves context |
| Display Agent | Listens to Orchestrator, manages top section content |

### Agent Communication Flow

```
User Input
    │
    ▼
┌──────────────────────────────────────────┐
│           Tutor Agent                     │
│  - Processes user message                │
│  - Provides conversational response      │
│  - Gives feedback ("You're close")       │
│  - Guides through practice questions     │
│  - Reports response outcomes to          │
│    Orchestrator                          │
└──────────────────────────────────────────┘
    │
    ▼ (with user message context)
┌──────────────────────────────────────────┐
│           Orchestrator                    │
│  - Monitors flow                         │
│  - Decides when to involve others        │
│  - Provides constraints/directions       │
│  - Triggers Researcher when needed       │
│  - Directs Display Agent updates         │
│  - Tracks progress & calculates score    │
│  - Adjusts complexity based on perf.     │
└──────────────────────────────────────────┘
    │
    ├──────────────────┬───────────────────┐
    ▼                  ▼                   ▼
┌────────────┐  ┌──────────────┐  ┌───────────────┐
│ Researcher │  │Display Agent │  │ Continue to   │
│            │  │              │  │ Tutor         │
│ - Fetches  │  │ - Updates    │  │ (with context)│
│   lesson   │  │   top        │  │               │
│   context  │  │   section    │  │               │
└────────────┘  └──────────────┘  └───────────────┘
    │
    ▼
┌──────────────────────────────────────────┐
│        PostgreSQL (via API)              │
│  - Store/update user_progress            │
│  - Track struggles, score, complexity    │
└──────────────────────────────────────────┘
```

### Agent Details

#### Tutor Agent
- **Primary interface:** Chat (bottom section of Tab 2)
- **Responsibilities:**
  - Handle all user conversation
  - Provide real-time feedback ("You're close", "Good guess")
  - Walk through practice questions
  - Guide with active learning techniques
  - Reference lesson content from Researcher
  - Ask follow-up questions based on lesson
- **Response pattern example:**
  ```
  "Let's try the above question together.
   You're close, but remember, the lesson mentioned {context from Researcher}.
   Based on that, which option would you pick now?"
  ```

#### Orchestrator
- **Role:** Central coordinator
- **Responsibilities:**
  - Monitor conversation flow
  - Detect when additional context is needed
  - Direct Researcher to fetch relevant lesson data
  - Decide when to update the display section
  - Provide constraints to Tutor ("stay within lesson content")
  - Detect confusion and direct Tutor accordingly
  - **Track user progress and scoring:**
    - Monitor user responses to practice questions
    - Track struggles (topics where user needs more work)
    - Calculate score based on correct answers, attempts needed, hints used
    - Adjust complexity_level for future practice (harder if doing well, easier if struggling)
    - Store progress to PostgreSQL via API

#### Researcher
- **Role:** Data retrieval
- **Responsibilities:**
  - Query PostgreSQL for lesson content
  - Retrieve relevant sections based on conversation
  - Fetch practice questions and answers
  - Provide context to Tutor for feedback

#### Display Agent
- **Role:** Content management
- **Responsibilities:**
  - Listen to Orchestrator directives
  - Update top section with:
    - Summaries of lesson key points
    - Snippets of important information
    - Practice questions
    - Hints and guidance
  - Maintain state of what's displayed

### Progress Tracking & Scoring

The Orchestrator tracks user performance throughout the lesson:

**Score Calculation:**
- Base score starts at 100
- Deduct points for incorrect answers
- Deduct more points for requiring hints
- Bonus for correct answers on first try
- Final score: 0-100 scale

**Struggle Tracking:**
- Topics/concepts where user needs multiple attempts
- Stored in `struggles` JSONB field
- Used to prioritize those topics in future practice exams

**Complexity Adjustment:**
- `complexity_level` (1-5) adjusts based on performance
- Doing well → increase complexity for next practice
- Struggling → decrease complexity, focus on fundamentals
- Guides what practice questions to show

---

## 6. Data Model (PostgreSQL)

### Tables

**lessons**
- id (UUID, PK)
- title (VARCHAR)
- video_transcript (TEXT)
- summary (TEXT)
- key_points (JSONB)
- practice_questions (JSONB)

**user_progress**
- id (UUID, PK)
- user_email (VARCHAR)
- lesson_id (UUID, FK)
- completed (BOOLEAN)
- current_position (INT)
- last_accessed (TIMESTAMP)
- score (INT) - Overall performance score (0-100)
- struggles (JSONB) - Topics/concepts user struggled with
- attempts (JSONB) - Per-question attempt counts and outcomes
- complexity_level (INT) - Current difficulty level (1-5), adjusts based on performance

**chat_history**
- id (UUID, PK)
- user_email (VARCHAR)
- lesson_id (UUID, FK)
- messages (JSONB)
- created_at (TIMESTAMP)

---

## 7. API Endpoints

### Express API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/validate` | POST | Validate iframe params, establish session |
| `/api/lesson/:id` | GET | Get lesson data (transcript, summary) |
| `/api/chat` | POST | Send message to Tutor Agent |
| `/api/progress` | GET/POST | Get/update user progress |

### Internal (Python Service)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/agent/chat` | POST | Main agent interaction endpoint |
| `/agent/context/:lessonId` | GET | Get lesson context for agent |

---

## 8. Implementation Phases

### Phase 1: Foundation
- Set up Express API with frontend
- Configure security headers and CORS
- Set up Python service structure

### Phase 2: Database & Basic UI
- Create PostgreSQL tables
- Build Tab 1 (Transcript view)
- Basic Tab 2 layout

### Phase 3: Agent System
- Implement Orchestrator
- Implement Tutor Agent
- Implement Researcher
- Implement Display Agent

### Phase 4: Integration
- Connect chat interface to agent system
- Implement LaTeX rendering
- Polish UI/UX

### Phase 5: Security & Deployment
- Finalize security measures
- Docker configuration
- Testing and deployment

---

## 9. Acceptance Criteria

1. App loads only in iframe on parent domain
2. User email and lesson ID properly validated
3. Tab 1 displays full video transcript with LaTeX
4. Tab 2 has working chat with Tutor Agent
5. Top section of Tab 2 updates based on conversation
6. Researcher retrieves relevant lesson content
7. All database access goes through backend API
8. Python AI service not directly exposed to internet
9. App runs in Docker container

---

## 10. Open Questions

- Should chat history persist across sessions?
- How to handle LaTeX rendering performance?
- What's the expected latency for agent responses?