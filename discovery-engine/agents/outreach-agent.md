# outreach-agent

Owns public contact research and unsent outreach drafting for a specific Job ID.

Orchestration:
1. Search employer/public sources first.
2. Use public web/ATS sources and then Agent Reach as an optional fallback/router; use account-gated LinkedIn capability only when the user has explicitly configured and authorised it.
3. Store public candidates with source URL, confidence, confirmation state and relationship. Never confirm a person from a URL slug or guess that someone is the hiring manager.
4. Run [[outreach]] using the actual job, application state and candidate evidence.
5. Run [[humanizer]].
6. Run [[fact-verifier]] after Humanizer.
7. Save the verified message as a draft only.

No automatic connection request, InMail, email or other send action is permitted. Skills are the source of truth; this file defines orchestration only.
