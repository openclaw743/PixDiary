output "key_vault_id" {
  value = azurerm_key_vault.this.id
}

output "key_vault_name" {
  value = azurerm_key_vault.this.name
}

output "key_vault_uri" {
  value = azurerm_key_vault.this.vault_uri
}

output "secret_ids" {
  value = { for k, v in azurerm_key_vault_secret.secrets : k => v.id }
}

output "maps_subscription_key_secret_id" {
  value = azurerm_key_vault_secret.secrets["maps-subscription-key"].id
}

output "postgres_connection_string_secret_id" {
  value = azurerm_key_vault_secret.secrets["postgres-connection-string"].id
}

output "storage_connection_string_secret_id" {
  value = azurerm_key_vault_secret.secrets["storage-connection-string"].id
}

output "jwt_secret_secret_id" {
  value = azurerm_key_vault_secret.secrets["jwt-secret"].id
}
