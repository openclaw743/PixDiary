output "swa_id" {
  value = azurerm_static_web_app.this.id
}

output "swa_name" {
  value = azurerm_static_web_app.this.name
}

output "default_host_name" {
  value = azurerm_static_web_app.this.default_host_name
}

output "deployment_token" {
  value     = azurerm_static_web_app.this.api_key
  sensitive = true
}
