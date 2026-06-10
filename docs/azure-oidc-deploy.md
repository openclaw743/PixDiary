# Azure OIDC Deploy Runbook

This document is the **one-time setup** the TechLead must complete to make the
[`Deploy`](../.github/workflows/deploy.yml) workflow succeed. After this is done
once per environment (UAMI + federated credentials + repo variables), every
push to `main` will:

1. Wait for the matching `CI` run to go green.
2. OIDC-login to Azure as the deploy identity.
3. Build + push the backend image to ACR.
4. `terraform plan` (always) → manual approval via `dev-approve` environment →
   `terraform apply`.
5. Update the Container App with the new image digest.
6. Deploy the built SPA to Static Web Apps.

There are **no long-lived secrets in GitHub** — auth is entirely OIDC.

---

## Prerequisites

| Item | Value used in this project |
| --- | --- |
| Azure subscription | `Sub-LiShuo-MSFT` (`427d4176-864a-44c1-8470-468709ff9252`) |
| Tenant | `16b3c013-d300-468d-ac64-7eda0820b6d3` |
| Region | `westeurope` |
| Resource group | `rg-Sandbox` |
| GitHub repo | `openclaw743/PixDiary` |
| GitHub Environment | `dev-approve` (with TechLead as required reviewer) |

You will need `az` logged in as a user that can:

- Create User-Assigned Managed Identities (`Microsoft.ManagedIdentity/userAssignedIdentities/write`).
- Assign roles at subscription / resource group scope (`Microsoft.Authorization/roleAssignments/write`).
- Create federated credentials on a UAMI (`Microsoft.ManagedIdentity/userAssignedIdentities/federatedIdentityCredentials/write`).

```bash
az account set --subscription "427d4176-864a-44c1-8470-468709ff9252"
```

---

## 1. Create (or reuse) the deploy User-Assigned Managed Identity

We use a **User-Assigned Managed Identity (UAMI)** rather than a service
principal because:

- No client secret to rotate.
- Lives as an Azure resource — easy to inspect and destroy.
- Same identity can be reused for Container Apps managed-identity pulls.

```bash
RG=rg-Sandbox
LOC=westeurope
UAMI_NAME=id-pixdiary-deploy

az identity create \
  --resource-group "$RG" \
  --name "$UAMI_NAME" \
  --location "$LOC"

# Capture the IDs we'll need below + as GitHub repo variables.
export DEPLOY_CLIENT_ID="$(az identity show -g $RG -n $UAMI_NAME --query clientId -o tsv)"
export DEPLOY_PRINCIPAL_ID="$(az identity show -g $RG -n $UAMI_NAME --query principalId -o tsv)"
export TENANT_ID="$(az account show --query tenantId -o tsv)"
export SUB_ID="$(az account show --query id -o tsv)"

printf "AZURE_CLIENT_ID       = %s\n" "$DEPLOY_CLIENT_ID"
printf "AZURE_TENANT_ID       = %s\n" "$TENANT_ID"
printf "AZURE_SUBSCRIPTION_ID = %s\n" "$SUB_ID"
```

Take note of the three values above — you will paste them into GitHub repo
variables in §4.

---

## 2. Assign roles to the UAMI

The deploy identity needs **three** role assignments. Scope each one as narrowly
as possible.

### 2.a Contributor on the resource group (for Terraform apply)

```bash
az role assignment create \
  --assignee-object-id "$DEPLOY_PRINCIPAL_ID" \
  --assignee-principal-type ServicePrincipal \
  --role "Contributor" \
  --scope "/subscriptions/${SUB_ID}/resourceGroups/${RG}"
```

> If you eventually move Terraform state into a different RG, also grant
> `Storage Blob Data Contributor` on that storage account so the backend can
> write `tfstate`.

### 2.b AcrPush on the ACR (for `docker push`)

```bash
ACR_NAME=acrpixdiary           # adjust to your actual ACR

az role assignment create \
  --assignee-object-id "$DEPLOY_PRINCIPAL_ID" \
  --assignee-principal-type ServicePrincipal \
  --role "AcrPush" \
  --scope "$(az acr show -n $ACR_NAME --query id -o tsv)"
```

### 2.c Static Web Apps deployment

The deploy workflow uses `az staticwebapp secrets list` to fetch the
deployment token at runtime, so the UAMI needs the **`Website Contributor`**
role on the SWA resource:

```bash
SWA_NAME=swa-pixdiary          # adjust to your actual SWA

az role assignment create \
  --assignee-object-id "$DEPLOY_PRINCIPAL_ID" \
  --assignee-principal-type ServicePrincipal \
  --role "Website Contributor" \
  --scope "$(az staticwebapp show -g $RG -n $SWA_NAME --query id -o tsv)"
```

> If you'd rather store the SWA deploy token as a GitHub secret and skip role
> assignment, see the comment block at the top of `.github/workflows/deploy.yml`.

---

## 3. Add federated credentials on the UAMI

Federated credentials are what let GitHub Actions exchange its OIDC token for
an Azure access token without ever holding a client secret.

We need **two** credentials because the workflow runs in two distinct
GitHub contexts:

1. A push to `main` (matches `ref:refs/heads/main`).
2. The `terraform-apply` step inside the protected `dev-approve` environment.

```bash
REPO="openclaw743/PixDiary"

# (a) For everything triggered by a push to main.
az identity federated-credential create \
  --name "gh-main" \
  --identity-name "$UAMI_NAME" \
  --resource-group "$RG" \
  --issuer "https://token.actions.githubusercontent.com" \
  --subject "repo:${REPO}:ref:refs/heads/main" \
  --audiences "api://AzureADTokenExchange"

# (b) For the terraform-apply job, which runs in environment dev-approve.
az identity federated-credential create \
  --name "gh-env-dev-approve" \
  --identity-name "$UAMI_NAME" \
  --resource-group "$RG" \
  --issuer "https://token.actions.githubusercontent.com" \
  --subject "repo:${REPO}:environment:dev-approve" \
  --audiences "api://AzureADTokenExchange"
```

> If you later add a `pull_request` plan-only step, add a third credential
> with `subject "repo:${REPO}:pull_request"`.

---

## 4. Configure GitHub repo variables

In the repo: **Settings → Secrets and variables → Actions → Variables**.

| Variable | Where it comes from |
| --- | --- |
| `AZURE_CLIENT_ID` | `$DEPLOY_CLIENT_ID` printed in §1 |
| `AZURE_TENANT_ID` | `$TENANT_ID` printed in §1 |
| `AZURE_SUBSCRIPTION_ID` | `$SUB_ID` printed in §1 |
| `AZURE_RESOURCE_GROUP` | `rg-Sandbox` |
| `ACR_LOGIN_SERVER` | `acrpixdiary.azurecr.io` (or `terraform output acr_login_server`) |
| `ACR_NAME` | `acrpixdiary` (short name; no `.azurecr.io`) |
| `SWA_NAME` | `swa-pixdiary` (or `terraform output swa_name`) |
| `TF_STATE_RG` | RG holding the state storage account, e.g. `rg-Sandbox-tfstate` |
| `TF_STATE_STORAGE_ACCOUNT` | storage account name for tfstate, e.g. `stpixdiarytfstate` |
| `TF_STATE_CONTAINER` | usually `tfstate` |
| `TF_STATE_KEY` | usually `dev.tfstate` |

All of the above are **variables**, not secrets — OIDC means no actual secrets
need to live in GitHub.

---

## 5. Create the `dev-approve` GitHub Environment

In the repo: **Settings → Environments → New environment → `dev-approve`**.

- Add **Required reviewers** → TechLead (and anyone else who must approve a
  production-like apply).
- Optionally set **Wait timer** to 0 (default).

The `terraform-apply` job in `deploy.yml` already references
`environment: dev-approve`, so the run will pause for manual approval before
it ever touches Azure.

---

## 6. Verify

Once §1–§5 are done, the next push to `main` (or a manual `workflow_dispatch`
of `Deploy`) should:

1. Show `Wait for CI green` succeeding once the matching `CI` run finishes.
2. Show `Azure login (OIDC)` succeeding — if this step fails with
   `AADSTS70021: No matching federated identity record found`, double-check the
   `subject` strings in §3 against the exact branch/environment names.
3. Show `ACR login` succeeding — if it fails with
   `AuthorizationFailed`, re-check the `AcrPush` assignment in §2.b.
4. Pause at the `terraform-apply` job awaiting reviewer approval (§5).
5. Apply Terraform, push the backend image, update the Container App, and
   deploy the SPA to SWA.

---

## Common failure modes

### `AADSTS70021: No matching federated identity record found`

The OIDC subject GitHub sends doesn't match any federated credential on the
UAMI. The most common causes are:

- Workflow ran on a branch other than `main` (subject becomes
  `repo:...:ref:refs/heads/<branch>`). Either branch-restrict the workflow or
  add a federated credential for that branch.
- Step runs inside an environment without a matching credential. The
  `terraform-apply` job runs in environment `dev-approve` — verify the
  `environment:` credential exists.
- Tag-triggered run: subject becomes `repo:...:ref:refs/tags/<tag>`. Add a
  matching credential.

You can dump the OIDC token claims from inside a job for debugging:

```yaml
- name: Debug OIDC subject
  run: |
    curl -H "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" \
         "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=api://AzureADTokenExchange" \
         | jq -r .value | cut -d. -f2 | base64 -d 2>/dev/null | jq .
  env:
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: ${{ secrets.ACTIONS_ID_TOKEN_REQUEST_TOKEN }}
    ACTIONS_ID_TOKEN_REQUEST_URL: ${{ secrets.ACTIONS_ID_TOKEN_REQUEST_URL }}
```

### `Error: TF_STATE_KEY not set` / Terraform backend fails

The Terraform azurerm backend resolves `resource_group_name`,
`storage_account_name`, `container_name`, `key` from env vars
`ARM_*` or workflow inputs. Verify all five `TF_STATE_*` variables in §4 are
set and that the deploy identity has at least
**Storage Blob Data Contributor** on the state storage account.

### `Insufficient privileges to complete the operation`

Almost always means the UAMI is missing a role assignment. Re-run §2.

### `403 Forbidden: ACR does not allow anonymous`

The `az acr login --name ...` step depends on the AcrPush assignment from
§2.b. It can take 5–10 minutes for new role assignments to propagate; retry
the workflow.

---

## Decommission

```bash
az identity delete --resource-group "$RG" --name "$UAMI_NAME"
```

That removes the UAMI, all its role assignments, and all federated
credentials in a single call.
