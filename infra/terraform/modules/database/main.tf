terraform {
  required_version = ">= 1.6.0"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

resource "random_password" "admin" {
  length      = 24
  special     = true
  min_lower   = 2
  min_upper   = 2
  min_numeric = 2
  min_special = 2
  # Postgres Flexible Server password rejects these characters
  override_special = "_-+=()[]{}!?"
}

resource "azurerm_postgresql_flexible_server" "this" {
  name                = "psql-${var.name_prefix}"
  resource_group_name = var.resource_group_name
  location            = var.location

  version  = "16"
  sku_name = "B_Standard_B1ms"

  storage_mb            = 32768
  storage_tier          = "P4"
  backup_retention_days = 7

  administrator_login    = var.admin_username
  administrator_password = random_password.admin.result

  delegated_subnet_id           = var.postgres_subnet_id
  private_dns_zone_id           = var.postgres_private_dns_zone_id
  public_network_access_enabled = false

  zone = "1"

  tags = var.tags

  lifecycle {
    ignore_changes = [zone]
  }
}

# Allowlist pgcrypto extension at server level (required for gen_random_uuid)
resource "azurerm_postgresql_flexible_server_configuration" "extensions" {
  name      = "azure.extensions"
  server_id = azurerm_postgresql_flexible_server.this.id
  value     = "PGCRYPTO"
}

resource "azurerm_postgresql_flexible_server_database" "app" {
  name      = var.database_name
  server_id = azurerm_postgresql_flexible_server.this.id
  collation = "en_US.utf8"
  charset   = "UTF8"

  lifecycle {
    prevent_destroy = false
  }
}
