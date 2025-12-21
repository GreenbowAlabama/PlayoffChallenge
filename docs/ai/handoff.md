I rebuilt and tested in the iOS simulator and I’m still not seeing the payment-required message displayed gracefully in the UI.

Observed behavior:
	•	Unpaid user selects players
	•	Taps Save
	•	Save fails
	•	UI shows a generic error instead of the backend message

Actual error shown to the user:

Failed to save lineup: The operation couldn’t be completed. (PlayoffChallenge.APIError error 0.)

This means the backend error message is not making it to the final UI surface, even though it is being parsed in APIService.

Scope reminder (do not advance to Fix #2):
	•	Assume backend 403 response is correct and unchanged
	•	Do NOT redesign UI
	•	Do NOT add new flows
	•	Use existing error display mechanism only
	•	This is still Fix #1 continuation

Task:
	•	Trace where APIError.serverError(String) is handled after being thrown
	•	Identify why the associated error message is being lost
	•	Determine whether:
	•	The error is being caught as a generic Error
	•	The localizedDescription is not mapped
	•	The alert logic ignores associated values
	•	Propose the smallest possible UI fix so the backend message is shown verbatim

Deliverable:
	•	Return only the required code changes
	•	Use a single code block suitable for copy/paste
	•	Prefer minimal diffs or a focused function replacement
	•	No explanations unless strictly necessary

Available files to request next:
	•	LineupView
	•	Any shared error-handling helpers
	•	Alert or toast presentation logic

Tell me exactly which file you need next and why before proceeding.