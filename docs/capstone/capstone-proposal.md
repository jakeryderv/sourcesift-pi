# Personalized Newsletter and Article Agent

**Person:** Dirk Van Slyke

## Use Case

Dirk subscribes to roughly **25–35 newsletters across three email accounts** and checks them several times each day. They cover personal interests such as local news, business, technology, finance, investing, and entertainment, along with work topics such as **OCP mentions, marketing, and events**.

Today, he manually scans headlines and opens articles that seem useful. This capstone would build an agent that reads newsletter content, identifies linked articles, and recommends the ones most relevant to him.

The system would also keep articles searchable so he could ask questions such as:

* “What recent articles mention OCP?”
* “What technology articles should I read today?”

## Agentic Core

A normal script could extract every link and sort articles using fixed rules.

The agent instead decides:

* whether an article is relevant to this specific user,
* which interest area it belongs to,
* how important it is,
* and whether it needs to retrieve more article content before deciding.

Feedback on recommendations could gradually improve personalization.

If scope becomes too large, I would cut **automatic long-term preference learning** first.

## Architecture and Tools

```text
Newsletter Email
      ↓
Email / Newsletter Retrieval
      ↓
Article & Link Extraction
      ↓
Agent
 ├─ Judge relevance
 ├─ Retrieve article if needed
 ├─ Categorize
 └─ Rank
      ↓
Stored Recommendations
      ↓
Search / Browse / Ask Questions
```

### Main Tools

1. **Email/newsletter access**
   Retrieves newsletter content, headlines, and links.

2. **Article retrieval**
   Opens linked articles when the newsletter does not provide enough context.

3. **Search and storage**
   Stores recommendations, categories, and feedback so past articles remain searchable.

If live email access becomes unavailable, I can fall back to exported newsletter messages. If article retrieval fails, the agent can make a lower-confidence decision from newsletter content alone.

## Human-in-the-Loop

The main approval point is **long-term preference learning**.

The agent can recommend, categorize, and rank articles automatically, but it should not permanently change what it believes the user cares about without confirmation.

Example:

> “You have repeatedly selected articles about AI regulation. Should I add this as an ongoing interest?”

This prevents one bad assumption from affecting many future recommendations.

## Evaluation

I will create an evaluation set of about **20 real newsletter tasks**.

The user will label articles as:

* relevant,
* not relevant,
* uncertain.

The agent will process the same newsletters independently.

I will measure:

* **Precision:** how many recommendations are actually relevant.
* **Recall:** how many relevant articles the agent successfully finds.
* **Categorization:** whether articles are placed in useful categories.
* **Retrieval:** whether questions return the correct stored articles.

An initial target is roughly **80% recall and 70% precision** on the labeled evaluation set.

## Risks

The biggest assumption is that the user’s interests can be represented well enough from a small preference profile and feedback history.

I will test this early by collecting real newsletter articles, having the user label them, and comparing those labels with an initial agent’s recommendations.

Other risks include:

* inconsistent newsletter formatting,
* blocked article pages,
* duplicate links,
* API outages,
* model/tool costs.

## Work Plan

I will first collect representative newsletters and create the evaluation set. Next, I will build the newsletter parser and basic recommendation agent, then add article retrieval, storage, search, and a simple interface. Preference learning will come last.

For the design review, the goal is an end-to-end system that can:

**read a newsletter → inspect articles → make relevance decisions → call tools when needed → store and display recommendations.**

If the project falls behind, I will keep that core workflow and cut advanced preference learning, semantic search, or multi-account integration.
