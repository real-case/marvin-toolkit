# Severity and confidence

Severity is the impact on a user if the defect happens. Confidence is how sure the claim is
that it does happen. The two are set separately: a likely cosmetic glitch is `low` severity
and `high` confidence, a possible data leak is `critical` severity and `medium` confidence.

## Severity

| Severity | Meaning | Examples |
| --- | --- | --- |
| critical | Data loss or corruption, a security boundary crossed, money wrong, or a core journey impossible for everyone | another tenant's records readable; a payment charged twice; sign-in broken |
| high | A core journey broken for some users or some inputs, or wrong data shown as right | a whitespace-only token accepted; a total that ignores discounts; an error page on an empty cart |
| medium | A secondary flow broken, a workaround exists, or the defect needs an unusual state | a filter that drops the last page; a stale count until reload |
| low | Cosmetic, rare and harmless, or only visible to developers | a wrong plural; a log line with the wrong id |

Raise one step when the defect is silent (the user is not told anything went wrong) or hits a
journey the flow map marks `core`. Lower one step when the only path to it is an administrator
or a deliberately malformed request with no security consequence.

## Confidence

| Confidence | Meaning |
| --- | --- |
| confirmed | Reproduced: a reproducing test fails for the stated reason. Only the tool sets a finding to `confirmed`; a hunter never claims it. |
| high | The path from input to defect is traced through the code and no guard stops it. |
| medium | The path is plausible but depends on a state or configuration not verified. |
| low | A suspicion worth remembering. Logged in the ledger, never reported (NFR-08). |

A hunter that cannot write `reproduction.path_feasibility` in two sentences has at most
`medium` confidence.

## Severity floor

`hunt.severity_floor` in `.marvin/config.json` sets, per check, the lowest severity that is
challenged, proven and reported. Below the floor a claim is still recorded, so a later run
recognises it, but it gets no skeptic, no referee and no reproducing test.
