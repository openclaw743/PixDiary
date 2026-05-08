# PixDiary — Terraform (dev environment)

Provisions the Azure infrastructure for the PixDiary dev environment.

## Layout

```
infra/terraform/
├── environments/
│   └── dev/                     # entrypoint for the dev environment
│       ├── main.tf              # wires modules together
│       ├── providers.tf
│       ├── variables.tf
│       ├── outputs.tf
│       └── terraform.tfvars.example
└── modules/
    ├── network/                 # VNet + delegated subnets + private DNS for Postgres
    ├── database/                # Postgres Flexible Server B1ms (VNet-integrated, no public access)
    ├── storage/                 # Blob storage, private `photos` container, CORS locked to SWA + localhost
    ├── ai/                      # Azure AI Foundry (AIServices) + gpt-4o-mini and gpt-4o deployments
    ├── maps/                    # Azure Maps S0
    ├── keyvault/                # RBAC-mode Key Vault + secrets (postgres, storage, maps, jwt)
    ├── container-app/           # Container Apps Environment + backend Container App (UAMI, KV-backed secrets)
    └── swa/                     # Static Web App (Free, westeurope) — exposes BACKEND_API_BASE_URL
```

## Auth

This stack uses **managed identity** for `terraform apply`. Set:

```bash
export ARM_USE_MSI=true
export ARM_SUBSCRIPTION_ID=427d4176-864a-44c1-8470-468709ff9252
export ARM_TENANT_ID=<tenant>
```

No service principal credentials are committed to the repo.

## Backend state

Remote state is configured but **backend wiring is not committed**. TechLead supplies a
`backend.dev.hcl` at `init` time:

```hcl
# backend.dev.hcl (example, do not commit)
resource_group_name  = "rg-Sandbox"
storage_account_name = "sttfstatepixdiary"
container_name       = "tfstate"
key                  = "pixdiary/dev.tfstate"
use_azuread_auth     = true
```

Then:

```bash
cd infra/terraform/environments/dev
cp terraform.tfvars.example terraform.tfvars   # adjust if needed
terraform init -backend-config=backend.dev.hcl
terraform validate
terraform plan -out=dev.tfplan
# After TechLead reviews the plan:
terraform apply dev.tfplan
```

## Resources provisioned

| Resource | SKU | Notes |
|---|---|---|
| VNet (`vnet-pixdiary-dev`) | /16 | 2 subnets: container-app (/23, delegated to Microsoft.App), postgres (/24, delegated) |
| Postgres Flexible Server | `B_Standard_B1ms`, 32 GB, single AZ | VNet-integrated, public access disabled, `pgcrypto` allowlisted |
| Storage account | Standard LRS | Private `photos` container; CORS = SWA hostname + localhost:5173 only |
| Azure AI Foundry | `AIServices` S0 | `gpt-4o-mini` (default), `gpt-4o` (escalation, regenerate-with-better) |
| Azure Maps | S0 | Free up to 5k tx/month |
| Key Vault | Standard, RBAC | Holds postgres connection string, postgres admin password, storage connection string, maps key, jwt secret |
| Container Apps Environment + Backend App | Consumption | min=0, max=3 replicas; UAMI; KV-backed secrets; ingress :3000 |
| Static Web App | Free, **westeurope** | Frontend; backend FQDN injected as `BACKEND_API_BASE_URL` |
| Log Analytics workspace | PerGB2018, 30d | Container Apps logs |

## Estimated monthly cost (dev, idle-ish)

| Item | Estimate (€/month) |
|---|---:|
| Postgres B1ms + 32 GB storage | ~12 |
| Container Apps (Consumption, scale-to-zero) | ~0–3 |
| Storage (StandardLRS, < 5 GB) | < 1 |
| Static Web App (Free) | 0 |
| Azure Maps (S0, < 5k tx) | 0 |
| Log Analytics (< 1 GB ingested) | < 2 |
| Key Vault (Standard, ops-based) | < 1 |
| AI Foundry deployments (PAYG, no idle cost) | 0 |
| **Total (idle dev)** | **~€15–20/month** |

AI usage is metered separately and capped per-user via `ai_daily_cost` (see `docs/ARCHITECTURE.md`).

## Cleanup

```bash
terraform destroy
```

`rg-Sandbox` is a data source — Terraform never deletes the resource group.

— Rack
