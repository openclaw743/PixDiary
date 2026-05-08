output "server_id" {
  value = azurerm_postgresql_flexible_server.this.id
}

output "server_name" {
  value = azurerm_postgresql_flexible_server.this.name
}

output "fqdn" {
  value = azurerm_postgresql_flexible_server.this.fqdn
}

output "database_name" {
  value = azurerm_postgresql_flexible_server_database.app.name
}

output "admin_username" {
  value = var.admin_username
}

output "admin_password" {
  value     = random_password.admin.result
  sensitive = true
}

output "connection_string" {
  value     = "postgresql://${var.admin_username}:${urlencode(random_password.admin.result)}@${azurerm_postgresql_flexible_server.this.fqdn}:5432/${azurerm_postgresql_flexible_server_database.app.name}?sslmode=require"
  sensitive = true
}
