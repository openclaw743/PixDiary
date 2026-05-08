output "container_app_id" {
  value = azurerm_container_app.backend.id
}

output "container_app_name" {
  value = azurerm_container_app.backend.name
}

output "container_app_fqdn" {
  value = azurerm_container_app.backend.ingress[0].fqdn
}

output "environment_id" {
  value = azurerm_container_app_environment.this.id
}

output "log_analytics_workspace_id" {
  value = azurerm_log_analytics_workspace.this.id
}
