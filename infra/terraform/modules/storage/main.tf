terraform {
  required_version = ">= 1.6.0"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }
}

resource "azurerm_storage_account" "this" {
  name                     = var.storage_account_name
  resource_group_name      = var.resource_group_name
  location                 = var.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
  account_kind             = "StorageV2"

  min_tls_version                 = "TLS1_2"
  https_traffic_only_enabled      = true
  allow_nested_items_to_be_public = false
  public_network_access_enabled   = true

  blob_properties {
    versioning_enabled = false

    dynamic "cors_rule" {
      for_each = var.allowed_cors_origins
      content {
        allowed_origins    = [cors_rule.value]
        allowed_methods    = ["GET", "PUT", "POST", "HEAD", "OPTIONS"]
        allowed_headers    = ["*"]
        exposed_headers    = ["*"]
        max_age_in_seconds = 3600
      }
    }

    delete_retention_policy {
      days = 7
    }
  }

  network_rules {
    default_action             = "Allow" # SAS-only access pattern; tighten in prod
    bypass                     = ["AzureServices"]
    virtual_network_subnet_ids = var.allowed_subnet_ids
  }

  tags = var.tags
}

resource "azurerm_storage_container" "photos" {
  name                  = var.container_name
  storage_account_id    = azurerm_storage_account.this.id
  container_access_type = "private"
}
