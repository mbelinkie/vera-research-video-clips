# AWS hosting requirements and options for a 10–20 person team

Date checked: 2026-08-24  
Region used for estimates: `us-east-1`  
Purpose: planning estimate, not a production change authorization

## Short answer

No. Supporting 10–20 lightly active collaborators does **not** inherently cost
$100 per month. User count is not the main cost driver at this scale.

The repository's current production-shaped template costs well over $100/month
because it buys multiple kinds of availability at once: a Multi-AZ
`db.t4g.medium` database, two continuously running Fargate tasks, an Application
Load Balancer, public IPv4 addresses, and private-subnet egress through NAT or
multiple VPC endpoints. Those are reliability and isolation choices, not
capacity requirements for 10–20 users.

A reasonable small-team pilot can instead target roughly **$20–45/month**, with
an explicit single-instance or Single-AZ recovery tradeoff. A serverless rewrite
could idle lower, but it requires substantially more engineering than
right-sizing the current Node/PostgreSQL application.

All figures below are approximate on-demand monthly floors using 730 hours.
Storage, backups, data transfer, logs, taxes, and request volume can add cost.

## What “works as intended” requires

These are functional data/security requirements. They should not be removed
merely to reduce cost:

1. **Real Cognito authentication**
   - Public native client with authorization-code grant and S256 PKCE.
   - No client secret in the desktop application.
   - Admin-invited users for the initial private team.
   - Exact native callback, refresh/revocation, and logout handling.
2. **One authoritative PostgreSQL catalog**
   - Project membership and roles.
   - Projects, videos, batches, jobs, clips, comments, bookmarks, manifests,
     optimistic versions, idempotency receipts, and notification state.
   - Transactional migrations and tested restore behavior.
   - PGlite remains useful for tests/local fixtures, but should not be the only
     shared authority for a multi-user deployment.
3. **Durable private transcript-object storage**
   - Private, encrypted, versioned S3 bucket.
   - Immutable project-version keys and disposable staging lifecycle rules.
   - Short-lived project-authorized upload/download URLs.
   - No memory object store for accepted shared transcript versions.
4. **Durable job delivery**
   - SQS Standard queue and DLQ with encryption and bounded retention.
   - Database leases/idempotency remain authoritative because SQS is
     at-least-once.
   - No memory-only queue for work that must survive a server restart.
5. **One trusted HTTPS API endpoint**
   - Cognito JWT verification and project authorization on every protected
     route.
   - Stable DNS/TLS identity suitable for packaged clients.
   - Health checking and automatic process restart.
6. **Least-privilege AWS access**
   - An EC2 instance role or ECS task role, not a long-lived access key.
   - Scoped S3/SQS access and optional Amazon Translate access only on the API.
   - No AWS credentials in Electron, React, source control, logs, or user data.
7. **Backups and recovery**
   - Automated PostgreSQL backup plus a separate tested logical dump.
   - Retention policy, restore instructions, and a real restore drill.
   - Alerts for backup/API failure and a documented recovery-time expectation.
8. **Basic operations and cost controls**
   - Bounded logs without credentials or transcript content.
   - CPU/disk/API health monitoring.
   - A monthly AWS Budget alert and named owner for billing notifications.
   - Patch/redeploy and rollback procedure.

Hosted GPU transcription workers, cloud clip storage, multiple API replicas,
Multi-AZ database failover, NAT gateways, and 24/7 zero-downtime deployment are
**not capacity requirements** for 10–20 users. They are optional availability,
automation, and scale features.

## Options

### Option A — Current development stack: about $11/month

**Shape**

- One `t4g.micro` EC2 instance.
- Caddy HTTPS and Cognito.
- PGlite on the instance volume.
- Memory transcript object store and memory queue.

**Good for**

- Testing the real desktop sign-in and callback.
- Personal UI dogfood and disposable data.

**Not sufficient for a team**

- Transcript objects and queue messages disappear on API restart.
- Replacing/deleting the instance loses the catalog.
- No tested backup/restore path or least-privilege S3/SQS runtime role.

This is the environment currently deployed. It should not receive irreplaceable
shared research.

### Option B — Single-host small-team pilot: about $20–30/month

**Recommended when the priority is the lowest practical pilot bill.**

**Shape**

- One `t4g.small` (2 GiB) or `t4g.medium` (4 GiB) EC2 instance.
- Caddy HTTPS directly on the instance; no ALB or NAT gateway.
- API and PostgreSQL on the same encrypted instance/attached volume.
- Private S3 bucket and SQS/DLQ accessed through an instance role.
- Cognito for 10–20 invited users.
- Daily encrypted EBS snapshot plus PostgreSQL logical backup to S3.
- Registered desktop/local workers; no always-on hosted media worker.

**Approximate floor**

| Component                         |      Small |     Medium |
| --------------------------------- | ---------: | ---------: |
| EC2 compute                       |     $12.26 |     $24.53 |
| One public IPv4                   |      $3.65 |      $3.65 |
| 20 GiB gp3                        |      $1.60 |      $1.60 |
| S3/SQS/Cognito/light logs/backups |       $1–5 |       $1–5 |
| **Expected floor**                | **$19–23** | **$31–35** |

**Tradeoffs**

- One failure domain: API and database are unavailable during instance failure,
  maintenance, or replacement.
- Recovery is from snapshot/dump rather than automatic failover.
- Database upgrades and operating-system patching are operator-owned.
- A restore drill is mandatory before inviting collaborators.

For light collaboration, this has enough capacity. The reason to choose the
4 GiB instance is operational headroom for Node, PostgreSQL, migrations, and
bursty project reads—not the number of Cognito users.

### Option C — EC2 API plus Single-AZ managed RDS: about $35–45/month

**Recommended balance when shared research durability matters more than the
absolute minimum bill.**

**Shape**

- One `t4g.small` EC2 API instance with Caddy HTTPS.
- Single-AZ RDS PostgreSQL `db.t4g.micro` with 20 GiB storage and automated
  backups.
- Private S3, SQS/DLQ, Cognito, and an EC2 instance role.
- No ALB and no NAT gateway: the API instance is in a tightly scoped public
  subnet; RDS has no public address and accepts PostgreSQL only from the API
  security group.

**Approximate floor**

| Component                           |          Monthly |
| ----------------------------------- | ---------------: |
| `t4g.small` API                     |           $12.26 |
| One public IPv4                     |            $3.65 |
| EC2 gp3 storage                     |      about $1.60 |
| Single-AZ `db.t4g.micro` PostgreSQL |           $11.68 |
| 20 GiB RDS gp2 storage              |            $2.30 |
| S3/SQS/Cognito/logs/backups         |       about $2–8 |
| **Expected floor**                  | **about $34–40** |

**Tradeoffs**

- RDS handles database backups, maintenance primitives, monitoring, and volume
  durability better than a self-managed database.
- It is still Single-AZ. An AZ/database failure requires restore or replacement
  rather than automatic standby failover.
- The one API instance still causes maintenance downtime, usually minutes.

For 10–20 users, this is likely the best first serious shared deployment.

### Option D — Serverless API/database: potentially $5–30 when mostly idle

**Shape**

- API Gateway or Lambda Function URL plus Lambda.
- Aurora Serverless v2 PostgreSQL configured with minimum capacity `0` and
  auto-pause, or a larger DynamoDB application rewrite.
- S3, SQS, and Cognito remain managed/serverless.

**Why it can be inexpensive**

- Current supported Aurora versions can auto-pause at `0` ACUs and do not incur
  capacity charges while paused.
- Lambda/API request costs for 10–20 light users are usually small.

**Why it is not the immediate recommendation**

- The current API is a long-running Fastify process with startup migrations,
  PostgreSQL connection assumptions, and an interval queue pump.
- Lambda needs a request adapter, bounded connection strategy, migration
  ownership, queue/event composition, cold-start behavior, and new operational
  tests.
- Aurora Serverless v2 costs $0.12 per ACU-hour while active in this region; a
  workload that prevents auto-pause can cost more than a tiny fixed RDS
  instance.

Choose this only if minimizing idle spend justifies a dedicated engineering
slice and cold-start acceptance work.

### Option E — Existing production-shaped topology: roughly $150–220+/month

**Shape**

- Multi-AZ `db.t4g.medium` PostgreSQL.
- Two Fargate API tasks.
- Public HTTPS ALB.
- Private task/database subnets.
- NAT gateway or multiple interface endpoints for private egress.
- Managed secrets, alarms, and stronger availability controls.

**Material fixed costs before traffic**

- Multi-AZ `db.t4g.medium`: about **$94/month** before storage/I/O.
- Two 0.5-vCPU/1-GiB Fargate tasks: about **$36/month**.
- ALB: about **$16/month**, plus LCU usage and public IPv4 charges.
- One NAT gateway, if selected: about **$33/month**, plus per-GB processing.

This is appropriate only when automatic failover, private service networking,
multiple API replicas, and a stronger uptime target are worth the premium. It
is not necessary merely because the team has 10–20 accounts.

## Recommended staged path

### Stage 1 — Keep the current stack disposable

- Finish Cognito/native-callback dogfood.
- Store no irreplaceable shared transcripts in the memory-backed environment.
- Add a $15 budget alert if the environment remains online.

### Stage 2 — Build Option C for the first real team pilot

1. Approve a target budget of approximately $45/month.
2. Approve or register a stable DNS name for the API.
3. Grant one-time IAM administration needed to create a least-privilege EC2
   instance role; the current SSO PowerUser role cannot create IAM roles.
4. Add a dedicated pilot CloudFormation template rather than weakening the
   production template.
5. Provision Single-AZ RDS PostgreSQL, bootstrap a distinct runtime database
   role, and run all current cloud migrations.
6. Connect the API to private S3 and SQS/DLQ resources through its instance
   role; enable only the reviewed server-side services.
7. Add automated backups, logical dumps, bounded logs/alarms, and budget alerts.
8. Run clean/populated migration, membership, presigned object, queue retry,
   second-workstation, and restore acceptance tests.
9. Invite the 10–20 Cognito users only after restore and authorization tests
   pass.

### Stage 3 — Upgrade availability only when evidence justifies it

Move to Multi-AZ RDS, two API replicas, ALB/private networking, and hosted
workers only after measured usage or an uptime requirement shows that pilot
downtime/recovery is no longer acceptable.

## Decisions needed before Stage 2

- Maximum ordinary monthly budget and a hard alert threshold.
- Acceptable planned downtime for updates.
- Recovery point objective: for example, at most 24 hours, 1 hour, or near-zero
  data loss.
- Recovery time objective: for example, restore within 4 hours or automatic
  failover within minutes.
- Whether a custom domain is available.
- Whether Amazon Translate should be enabled and what consent/cost policy
  applies.
- Whether all transcription/export execution remains on registered local
  workstations.
- Who receives billing, backup-failure, and API-health alerts.

## Pricing and platform references

Rates were checked against the AWS Price List API and official AWS pages on
2026-08-24. Recheck immediately before deployment.

- [Amazon EC2 On-Demand pricing](https://aws.amazon.com/ec2/pricing/on-demand/)
- [Amazon RDS for PostgreSQL pricing](https://aws.amazon.com/rds/postgresql/pricing/)
- [AWS Fargate pricing](https://aws.amazon.com/fargate/pricing/)
- [Elastic Load Balancing pricing](https://aws.amazon.com/elasticloadbalancing/pricing/)
- [Amazon VPC pricing, including public IPv4 and NAT Gateway](https://aws.amazon.com/vpc/pricing/)
- [Amazon Cognito pricing](https://aws.amazon.com/cognito/pricing/)
- [Aurora Serverless v2 auto-pause](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-auto-pause.html)
- [Amazon S3 pricing](https://aws.amazon.com/s3/pricing/)
- [Amazon SQS pricing](https://aws.amazon.com/sqs/pricing/)
