/**
 * Retrieval-augmented generation skills.
 *
 * **Provenance.** These were written for AgentOS, and nothing here is copied.
 *
 * The trail, since it is worth stating precisely rather than vaguely: MCP
 * Market lists a `rag-engineering-architect` skill, and that listing is
 * discovery metadata we could not fetch (the site answers 429 behind a bot
 * wall). A full search of the repository it points at,
 * `sickn33/agentic-awesome-skills`, finds **no skill by that name** — the
 * nearest are `rag-engineer`, whose own frontmatter attributes it upstream to
 * `vibeship-spawner-skills` under Apache-2.0, and `rag-implementation`. So
 * there was no artefact to adapt even had we wanted to, and the licences
 * (MIT for that repo's code, CC-BY-4.0 for its prose, Apache-2.0 upstream)
 * never came into play: the wording below is original, and those sources are
 * cited as research inspiration rather than as its origin.
 *
 * Same constraint as every other skill in this catalogue: the body is inlined
 * into the system prompt of every session that holds it, so each is short.
 * AgentOS does not implement Anthropic's SKILL.md progressive disclosure, and
 * these do not pretend otherwise — a skill that wants to be five pages long
 * belongs on the agent filesystem as a `file` skill.
 */

import type { SkillSeed } from "./types";

export const RAG_SKILL_SEEDS: SkillSeed[] = [
  {
    slug: "rag-architecture",
    name: "RAG architecture",
    category: "data",
    description:
      "Decide whether retrieval is warranted, then choose chunking, retrieval mode and assembly from the document structure rather than by default. Grant it to agents designing or reviewing a RAG system.",
    kind: "prompt",
    body: `Start by asking whether this needs retrieval at all. A small stable corpus
belongs in the prompt; a question with one system of record belongs in a tool
call. Retrieval earns its complexity when the corpus is large, changes, and has
to be cited.

Chunk along the document's own structure — sections, functions, row groups —
not at a fixed token count, and make each chunk interpretable alone by carrying
its title and path with it. State the overlap and why.

Choose retrieval deliberately: vector for paraphrase, keyword for identifiers
and error strings, hybrid when both matter, which is most of the time. Add a
reranker only if you can say what it buys against its latency.

Assembly is a budget. Say what is included, in what order, and what is dropped
first when the budget is exceeded. Every claim an answer makes must be traceable
to a retrieved chunk, so citations are part of the design and not a formatting
step at the end.`,
  },
  {
    slug: "retrieval-evaluation",
    name: "Retrieval evaluation",
    category: "data",
    description:
      "Measure retrieval and answers separately against a fixed question set, and use recall@k before touching the prompt. Grant it to agents building or tuning a RAG system.",
    kind: "prompt",
    body: `Build the evaluation set before tuning anything: real questions, each with the
documents that should have been retrieved. Fifty honest examples beat a
thousand generated ones.

Measure the two halves separately, because they fail differently.

**Retrieval.** recall@k is the first number — if the right document was not in
the top k, no prompt change can save the answer. precision@k tells you how much
noise the model must ignore. MRR and nDCG matter only when rank order genuinely
affects the answer; on a system that concatenates all k chunks they are
decoration, so do not report them as if they were the goal.

**Answers.** Faithfulness — is every claim supported by a retrieved chunk — and
citation correctness, which is a separate question from whether the answer is
right. An answer that is correct and cites the wrong source will be trusted the
next time it is wrong.

Record latency and cost per query alongside quality. A change that improves
recall by two points and doubles latency is a trade the operator makes, not one
you make silently.`,
  },
  {
    slug: "rag-security",
    name: "RAG security",
    category: "security",
    description:
      "Treat retrieved documents as untrusted input, enforce access control in the retrieval filter, and keep tenants apart at the index. Grant it alongside any RAG work that touches private or user-supplied content.",
    kind: "prompt",
    body: `A retrieved document is input, not instruction. Anything indexed from a
source a user or a third party can write — tickets, wiki pages, uploaded files,
scraped web pages — can contain text aimed at the model reading it. Keep
retrieved content clearly delimited from instructions, never let it change the
system prompt's rules, and be specific about which tools remain callable while
retrieved text is in context.

Enforce access control in the **retrieval filter**, not in the prompt. A
document the reader may not see must be unreachable by the query, because
"do not mention this" is not an access control and a summary leaks it anyway.

Multi-tenant systems isolate at the index or the mandatory filter, and the
filter is applied server-side from the authenticated identity — never from a
value the caller supplied.

Know where personal data is before indexing it, not after. Deletion must reach
the vector store, the keyword index, and every cache, or "deleted" means
"invisible in one of four places".`,
  },
  {
    slug: "document-ingestion-discipline",
    name: "Document ingestion discipline",
    category: "data",
    description:
      "Parse and normalise documents without silently destroying structure, and version the pipeline so a reindex is reproducible. Grant it to agents building ingestion for a retrieval system.",
    kind: "prompt",
    body: `Most bad retrieval is bad ingestion. Check what the parser actually produced
before tuning anything downstream: tables flattened into word salad, headings
lost, code blocks reflowed, and page furniture repeated into every chunk are the
usual damage, and none of it shows up until answers are subtly wrong.

Normalise deliberately — whitespace, encoding, boilerplate removal — and keep
the original alongside the derived text so a reparse is possible without
refetching.

Every chunk carries provenance: source id, version, location within the
document, and ingestion timestamp. Without it citations cannot be verified and
deletion cannot be targeted.

Version the pipeline itself, including the embedding model. Changing the
embedding model invalidates the whole index — vectors from two models are not
comparable — so treat it as a reindex with a rollback plan, not a config
change.`,
  },
];
