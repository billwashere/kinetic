---
id: concept:project
kind: concept
title: Project
summary: A named unit of work inside a workspace, created by an authenticated user.
relationships:
  - type: part_of
    target: concept:workspace
  - type: documented_by
    target: procedure:create_project
    evidence:
      - type: playwright-step
        page: create_project
        step: submit
        description: The documented walkthrough ends by submitting the new-project form.
---

A project is created from the projects dashboard by giving it a name and submitting the form.
The step-by-step procedure is the authoritative how-to; this page defines what a project *is*.
