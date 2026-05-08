terraform {
  required_version = ">= 1.6.0"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }
}

resource "azurerm_maps_account" "this" {
  name                = "maps-${var.name_prefix}"
  resource_group_name = var.resource_group_name
  location            = var.location
  sku_name            = "S0"

  tags = var.tags
}
