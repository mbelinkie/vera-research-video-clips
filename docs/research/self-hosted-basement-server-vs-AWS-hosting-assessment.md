# Self-hosted basement server vs. AWS hosting — assessment and considerations

Date: 2026-08-25
Companion to: `AWS-small-team-hosting-requirements-and-options.md` (2026-08-24)
Purpose: second-opinion review of that document, plus an evaluation of buying
physical hardware and self-hosting at home instead of renting cloud compute.

## 1. Review of the AWS hosting document

The document's analysis holds up. Its central claim is correct: for 10–20
lightly active users, user count is not the cost driver. The $150–220+/month
production-shaped template is paying for availability (Multi-AZ RDS failover,
two Fargate replicas, ALB, NAT gateway), not capacity. Twenty light users are
a trivial load for even a 2 GiB instance.

Spot-checked pricing (us-east-1, on-demand, 2026-08-25) — all figures in the
document match current published rates:

| Item                         |  Document |  Verified |
| ---------------------------- | --------: | --------: |
| `t4g.small` EC2              | $12.26/mo | $12.26/mo |
| `db.t4g.micro` RDS Single-AZ | $11.68/mo | $11.68/mo |
| Public IPv4                  |  $3.65/mo |  $3.65/mo |
| ALB fixed                    |   ~$16/mo |   ~$16/mo |
| NAT gateway fixed            |   ~$33/mo |   ~$33/mo |

Judgment calls in the document that are also right:

- Keeping the current PGlite / memory-store environment disposable. Data that
  vanishes on API restart is disqualifying for shared research.
- Steering away from the serverless rewrite (Option D). Adapting a
  long-running Fastify process with startup migrations and an interval queue
  pump to Lambda is real engineering to save perhaps $15/month.
- Option C (EC2 API + Single-AZ RDS, ~$35–45/mo) as the first serious team
  deployment. For ~$15/month over Option B, RDS takes database backups,
  patching, and storage durability off the operator's plate — likely the best
  $15 in the stack for a team with no dedicated ops person.

Minor caveats (none change the conclusions):

- The floors slightly undercount: EBS snapshot storage (~~$0.05/GiB-mo),
  CloudWatch, and data transfer out add a few dollars. Budget Option B as
  "~$25" and Option C as "~~$40" rather than the table floors.
- If the pilot runs long-term, a 1-year no-upfront Compute Savings Plan cuts
  the EC2 line ~30–40%. Not mentioned in the document.
- A non-AWS VPS (e.g. Hetzner, ~$5/mo) could host the API, but the stack is
  welded to Cognito, S3, and SQS, so leaving AWS adds cross-cloud latency and
  credential complexity for little savings.

## 2. Hardware for a self-hosted server

The hardware bar is low. The ~$25/month cloud option being replaced is 2
virtual cores and 2–4 GiB RAM; nearly any current mini PC exceeds that.

Sensible target spec:

- 4-core x86 CPU (Intel N100/N150 class or better)
- 16 GiB RAM
- 500 GB NVMe SSD
- Wired ethernet
- Small UPS (~$50–60)
- An off-site destination for backups (a drive next to the server fails with
  the server)

Candidate hardware:

| Option                                                         |     Cost | Notes                                        |
| -------------------------------------------------------------- | -------: | -------------------------------------------- |
| New N100/N150 mini PC (Beelink, GMKtec, Minisforum)            | $130–200 | 16 GB / 500 GB configs common; 6–10 W idle   |
| Used corporate mini desktop (OptiPlex Micro, ThinkCentre Tiny) |  $80–150 | Best price/performance if used is acceptable |
| Raspberry Pi 5 8GB + SSD                                       |    ~$120 | Workable; worse value, ARM quirks; last pick |

All-in roughly $150–250 once, plus $1–2/month electricity. Versus Option C
(~$40/mo) the hardware pays for itself in about five months.

## 3. Basement server vs. hosted: the real tradeoffs

The hardware is a solved problem — modern mini PCs are appliance-reliable and
Linux on them is boring in the good way. The experience gap is everything
around the box.

**What hosted buys that a basement does not:**

- **Power and network.** A data center delivers 99.9%+ uptime without
  thought. Residential ISP + power realistically lands nearer 99% — hours of
  outage per month, at random times, sometimes during travel.
- **Someone else's pager.** When AWS breaks, fixing it is their job. When the
  basement server breaks, the operator is the ops team, and "the tool is down
  until I get home" is what 10–20 collaborators experience.
- **No residential-hosting chores.** Dynamic IP (cleanly solvable with a
  Cloudflare Tunnel — also avoids port-forwarding and exposing the home
  network), OS patching on the operator's calendar, and getting backups
  off-site.

**What the basement buys:**

- ~$400–450/year of savings after hardware payback.
- Full control, no cloud bill anxiety, real hardware for other uses.
- A genuinely good dev/staging environment regardless of the production
  decision.

**Project-specific wrinkle:** the stack uses Cognito, S3, and SQS wherever
the API lives. A basement box still calls AWS for auth, transcript objects,
and the job queue — an AWS account and a few dollars of monthly spend remain
either way. Self-hosting relocates the compute; it does not escape AWS.
Replacing those services (MinIO, a Postgres-backed queue, self-hosted auth)
is real engineering not costed in any current estimate.

## 4. Recommendation

- **As the team's production server:** the basement box trades ~$35/month of
  savings for personally owning every outage. For a 10–20 person research
  team, that is a bad trade. The AWS document's Option C (~$40/mo, EC2 +
  Single-AZ RDS) remains the right home for the shared catalog.
- **As dev/staging, a personal instance, or a local transcription worker
  host:** a basement mini PC is a great experience and worth buying. The AWS
  document already assumes transcription/export runs on registered local
  workstations — a basement box fits that role naturally.
- **The deciding question is social, not technical:** if the team's tolerance
  for "it's down sometimes, it'll be fixed tonight" is genuinely high,
  self-hosting production becomes defensible. That is a question about the
  collaborators, not the hardware.

## References

- [Amazon EC2 On-Demand pricing](https://aws.amazon.com/ec2/pricing/on-demand/)
- [t4g.small pricing (Vantage)](https://instances.vantage.sh/aws/ec2/t4g.small)
- [db.t4g.micro RDS pricing (Vantage)](https://instances.vantage.sh/aws/rds/db.t4g.micro)
- [N100/N150 mini PC home server roundup](https://homelabpicks.com/mini-pc/best-n100-n150-mini-pc/)
- [N100 homelab builds](https://homelabstarter.com/homelab-n100-mini-pc-builds/)
