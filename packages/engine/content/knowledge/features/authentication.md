---
id: feature:authentication
kind: feature
title: Authentication
summary: Signing in with a registered email address before using the application.
relationships:
  - type: documented_by
    target: procedure:create_project
    evidence:
      - type: playwright-step
        page: create_project
        step: login_email
        description: The first step of the project walkthrough is entering the registered email.
---

Sign-in is a prerequisite for every other feature. It is demonstrated as the opening step of
other procedures rather than documented on a page of its own.
