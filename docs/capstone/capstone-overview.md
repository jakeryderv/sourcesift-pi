# Capstone Overview

The capstone is an end-to-end agentic system for a realistic information-work use case, built by you over about ten weeks, defended live in a design review in October, and demonstrated to the class in December. It is worth 210 points across four milestones plus the 190-point design review, and everything else in the course feeds it: each build challenge produces a piece you can reuse, and the graduate deliverables hang off the same project.

## What counts as an information-work use case

Information work is what a person does with information all day: reading, sorting, looking things up, drafting, checking, summarizing, deciding what deserves attention. A use case is one real person and one of those tasks they do over and over. The person can be you, but it is easier to evaluate when it is someone else, because you can ask them whether the output was right.

One distinction matters more than any other. In this course you use coding agents such as OpenClaw and Claude Code to build things. That is how you work here, and it is what Build Challenge 0 and 0b practiced. It is not a capstone. The capstone is an agent you build: your code runs the loop, a model you call decides what to do next, it calls tools you wrote or wired up, and a human approves the one step that would be expensive to get wrong. Using an agent to build your website is a tool. Building an agent that reads your customer's incoming orders and drafts the replies is a capstone.

## How to find one

Do not start from technology. Start from a person and a task, then answer two questions. First, what does the agent decide, as opposed to what a script would do in a fixed order? If the answer is nothing, and the system is a script with a language model in the middle of it, it is not an agent yet. Second, what does the agent need to be able to see that it cannot see right now? That is your first tool. A use case that answers both in a sentence each is a Project Idea Memo.

For scale, think of an agent that triages a lab's incoming papers and flags the three worth reading this week, or one that reads routine email for a small business and drafts replies but asks before sending, or one that checks a folder of documents against a policy that just changed and lists what needs a human decision. Each has a person, a repeated task, a real decision, something the agent must look at, and an obvious place for the human gate.

Keep the scope small enough to build in ten weeks while also doing four build challenges, and say in the memo what you would cut first. Do reach for real, current services: live web search, hosted storage, third-party APIs, and deployment are encouraged and are part of what the course teaches. Design the project so it runs on a modest token budget; an evaluation set of twenty tasks that you can rerun for a few dollars is worth more than one impressive run you cannot afford to repeat.

## Milestones

- Project Idea Memo, 10 points, Friday September 11. One page: the use case, why an agent fits, and the human-in-the-loop plan. Graded for completion. The idea can change after this, and usually does.
- Capstone Proposal, 30 points, Friday September 18. Scoped use case, architecture, tools, evaluation plan, risks, and a one-paragraph work plan. Peer reviewed with the five-question rubric in the assignment before you submit.
- Capstone Design Review and Progress Checkpoint, 190 points. An architecture document from everyone, a working end-to-end slice, early evaluation evidence, and an 8-minute live defense. Presentations run across Session 6 on October 16 and Session 7 on October 23; you present on one date and attend both. The document deadline is on the assignment.
- Capstone Demo Build and Readiness, 60 points, Friday November 20.
- Capstone Final Report and Presentation, 110 points, Friday December 11, with the live demonstration and postmortem in Session 13.

## The five questions your proposal has to survive

The proposal rubric asks a peer reviewer five things: whether one person can build it in ten weeks, what the agent actually decides, which two or three tools it needs and what happens if one is unavailable in week eight, how you will know it works, and what the single riskiest assumption is and when you will find out whether it is true. Write the memo with those five in mind and the proposal is mostly done.
