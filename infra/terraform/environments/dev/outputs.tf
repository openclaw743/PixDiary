output "swa_default_hostname" {
  description = "Azure Static Web App default hostname (e.g. xxxx.azurestaticapps.net)"
  value       = module.swa.default_host_name
}

output "container_app_fqdn" {
  description = "Backend Container App FQDN"
  value       = module.container_app.container_app_fqdn
}

output "postgres_fqdn" {
  description = "Postgres Flexible Server FQDN (private, VNet only)"
  value       = module.database.fqdn
}

output "storage_account_name" {
  value = module.storage.storage_account_name
}

output "keyvault_uri" {
  value = module.keyvault.key_vault_uri
}

output "maps_subscription_key_secret_id" {
  description = "Key Vault secret ID for the Azure Maps subscription key"
  value       = module.keyvault.maps_subscription_key_secret_id
}

output "container_app_managed_identity_client_id" {
  value = azurerm_user_assigned_identity.app.client_id
}

output "acr_login_server" {
  description = "ACR login server (used by GitHub Actions ACR_LOGIN_SERVER variable)"
  value       = module.acr.login_server
}

output "acr_name" {
  description = "ACR name without .azurecr.io"
  value       = module.acr.name
}

output "swa_name" {
  description = "Static Web App resource name (used by GitHub Actions SWA_NAME variable)"
  value       = "swa-${var.name_prefix}"
}
