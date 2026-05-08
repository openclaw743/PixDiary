output "maps_account_id" {
  value = azurerm_maps_account.this.id
}

output "maps_account_name" {
  value = azurerm_maps_account.this.name
}

output "primary_access_key" {
  value     = azurerm_maps_account.this.primary_access_key
  sensitive = true
}
