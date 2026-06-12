terraform {
  required_version = ">= 1.6.0"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }
}

resource "azurerm_container_registry" "this" {
  # ACR names are 5-50 lowercase alphanumeric, globally unique.
  name                = replace("acr${var.name_prefix}", "-", "")
  resource_group_name = var.resource_group_name
  location            = var.location
  sku                 = "Basic"
  admin_enabled       = false
  tags                = var.tags
}

# Allow the container app's user-assigned identity to pull images.
resource "azurerm_role_assignment" "container_app_acr_pull" {
  scope                = azurerm_container_registry.this.id
  role_definition_name = "AcrPull"
  principal_id         = var.container_app_principal_id
}

# Allow the deploy UAMI to push images.
resource "azurerm_role_assignment" "deploy_acr_push" {
  count                = var.deploy_principal_id == "" ? 0 : 1
  scope                = azurerm_container_registry.this.id
  role_definition_name = "AcrPush"
  principal_id         = var.deploy_principal_id
}
