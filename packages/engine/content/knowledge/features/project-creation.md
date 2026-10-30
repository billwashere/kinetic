---
id: feature:project-creation
kind: feature
title: Project creation
summary: Creating a new project from the projects dashboard.
aliases:
  - New project
relationships:
  - type: implements
    target: concept:project
  - type: depends_on
    target: feature:authentication
    evidence:
      - type: playwright-step
        page: create_project
        step: login_email
        description: The walkthrough cannot start until the user has signed in.
  - type: documented_by
    target: procedure:create_project
    evidence:
      - type: playwright-step
        page: create_project
        step: nav
      - type: playwright-step
        page: create_project
        step: submit
evidence:
  - type: file
    path: packages/engine/e2e-tests/create-project.spec.ts
    symbol: Project Creation Flow
    description: The Playwright test that exercises this feature.
---

Creating a project is the canonical example of a procedure-backed feature: the behaviour is defined
here, the how-to is [[concept:project]]'s documenting procedure, and the Playwright test is the evidence.
