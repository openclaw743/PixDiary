terraform {
  required_version = ">= 1.6.0"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }
}

# Azure Static Web App — Free tier. Region must be westeurope (not swedencentral).
# The /api/* proxy to the Container App is defined in the frontend's
# staticwebapp.config.json (rewrites). On Free tier we expose the backend FQDN
# to the SWA build via app_settings so the frontend can rewrite at deploy time.
resource "azurerm_static_web_app" "this" {
  name                = "swa-${var.name_prefix}"
  resource_group_name = var.resource_group_name
  location            = var.location

  sku_tier = "Free"
  sku_size = "Free"

  app_settings = merge(
    var.app_settings,
    var.container_app_fqdn == "" ? {} : {
      BACKEND_API_BASE_URL = "https://${var.container_app_fqdn}"
    }
  )

  tags = var.tags
}
