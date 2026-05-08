terraform {
  required_version = ">= 1.6.0"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }
}

data "azurerm_client_config" "current" {}

resource "azurerm_key_vault" "this" {
  name                = "kv-${replace(var.name_prefix, "-", "")}"
  location            = var.location
  resource_group_name = var.resource_group_name
  tenant_id           = data.azurerm_client_config.current.tenant_id
  sku_name            = "standard"

  rbac_authorization_enabled    = true
  purge_protection_enabled      = false
  soft_delete_retention_days    = 7
  public_network_access_enabled = true

  tags = var.tags
}

# Allow the deploying principal (TechLead/CI) to manage secrets
resource "azurerm_role_assignment" "deployer_secrets_officer" {
  scope                = azurerm_key_vault.this.id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = data.azurerm_client_config.current.object_id
}

# Allow the Container App's managed identity to read secrets
resource "azurerm_role_assignment" "container_app_secrets_user" {
  scope                = azurerm_key_vault.this.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = var.container_app_principal_id
}

locals {
  secrets = {
    "postgres-connection-string" = var.postgres_connection_string
    "postgres-admin-password"    = var.postgres_admin_password
    "storage-connection-string"  = var.storage_connection_string
    "maps-subscription-key"      = var.maps_primary_key
    "jwt-secret"                 = var.jwt_secret
  }
}

resource "azurerm_key_vault_secret" "secrets" {
  for_each = local.secrets

  name         = each.key
  value        = each.value
  key_vault_id = azurerm_key_vault.this.id

  content_type = "text/plain"

  depends_on = [azurerm_role_assignment.deployer_secrets_officer]
}
