use wasm_bindgen::prelude::*;
use serde::{Serialize, Deserialize};
use serde_json::json;

#[derive(Serialize, Deserialize)]
pub struct ModuleInfo {
    name: String,
    version: String,
    hashlinks_version: String,
    creator: String,
    purpose: String,
    actions: Vec<ActionDefinition>,
    capabilities: Vec<Capability>,
    plugins: Vec<PluginDefinition>,
}

#[derive(Serialize, Deserialize)]
pub struct ActionDefinition {
    name: String,
    description: String,
    inputs: Vec<ParameterDefinition>,
    outputs: Vec<ParameterDefinition>,
    required_capabilities: Vec<Capability>,
}

#[derive(Serialize, Deserialize)]
pub struct ParameterDefinition {
    name: String,
    param_type: String,
    description: String,
    required: bool,
    validation: Option<ValidationRule>,
}

#[derive(Serialize, Deserialize)]
pub struct ValidationRule {
    #[serde(skip_serializing_if = "Option::is_none")]
    min: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max: Option<f64>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(tag = "type")]
pub enum Capability {
    #[serde(rename = "network")]
    Network { value: NetworkCapability },
    #[serde(rename = "transaction")]
    Transaction { value: TransactionCapability },
}

#[derive(Serialize, Deserialize, Clone)]
pub struct NetworkCapability {
    networks: Vec<String>,
    operations: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct TransactionCapability {
    transaction_types: Vec<String>,
    max_fee_hbar: Option<f64>,
}

#[derive(Serialize, Deserialize)]
pub struct PluginDefinition {
    name: String,
    version: String,
    url: String,
    description: String,
    required: bool,
}

#[wasm_bindgen]
pub struct WasmInterface;

#[wasm_bindgen]
impl WasmInterface {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self
    }

    #[wasm_bindgen(js_name = INFO)]
    pub fn info(&self) -> Result<String, JsValue> {
        let info = ModuleInfo {
            name: "Demo Actions Module".to_string(),
            version: "1.0.0".to_string(),
            hashlinks_version: "0.1.0".to_string(),
            creator: "HashGraph Online".to_string(),
            purpose: "Demo actions for counter and container blocks".to_string(),
            actions: vec![
                ActionDefinition {
                    name: "increment".to_string(),
                    description: "Increment the counter".to_string(),
                    inputs: vec![
                        ParameterDefinition {
                            name: "amount".to_string(),
                            param_type: "number".to_string(),
                            description: "Amount to increment by".to_string(),
                            required: false,
                            validation: Some(ValidationRule {
                                min: Some(1.0),
                                max: Some(100.0),
                            }),
                        },
                        ParameterDefinition {
                            name: "count".to_string(),
                            param_type: "number".to_string(),
                            description: "Current counter value".to_string(),
                            required: true,
                            validation: None,
                        },
                    ],
                    outputs: vec![
                        ParameterDefinition {
                            name: "count".to_string(),
                            param_type: "number".to_string(),
                            description: "Updated counter value".to_string(),
                            required: true,
                            validation: None,
                        },
                    ],
                    required_capabilities: vec![],
                },
                ActionDefinition {
                    name: "decrement".to_string(),
                    description: "Decrement the counter".to_string(),
                    inputs: vec![
                        ParameterDefinition {
                            name: "amount".to_string(),
                            param_type: "number".to_string(),
                            description: "Amount to decrement by".to_string(),
                            required: false,
                            validation: Some(ValidationRule {
                                min: Some(1.0),
                                max: Some(100.0),
                            }),
                        },
                        ParameterDefinition {
                            name: "count".to_string(),
                            param_type: "number".to_string(),
                            description: "Current counter value".to_string(),
                            required: true,
                            validation: None,
                        },
                    ],
                    outputs: vec![
                        ParameterDefinition {
                            name: "count".to_string(),
                            param_type: "number".to_string(),
                            description: "Updated counter value".to_string(),
                            required: true,
                            validation: None,
                        },
                    ],
                    required_capabilities: vec![],
                },
                ActionDefinition {
                    name: "reset".to_string(),
                    description: "Reset the counter to zero".to_string(),
                    inputs: vec![],
                    outputs: vec![
                        ParameterDefinition {
                            name: "count".to_string(),
                            param_type: "number".to_string(),
                            description: "Reset counter value (0)".to_string(),
                            required: true,
                            validation: None,
                        },
                    ],
                    required_capabilities: vec![],
                },
                ActionDefinition {
                    name: "toggleCounter".to_string(),
                    description: "Toggle visibility of counter block".to_string(),
                    inputs: vec![
                        ParameterDefinition {
                            name: "showCounter".to_string(),
                            param_type: "boolean".to_string(),
                            description: "Current visibility state of counter".to_string(),
                            required: true,
                            validation: None,
                        },
                    ],
                    outputs: vec![
                        ParameterDefinition {
                            name: "showCounter".to_string(),
                            param_type: "boolean".to_string(),
                            description: "Updated visibility state".to_string(),
                            required: true,
                            validation: None,
                        },
                    ],
                    required_capabilities: vec![],
                },
                ActionDefinition {
                    name: "toggleStats".to_string(),
                    description: "Toggle visibility of stats block".to_string(),
                    inputs: vec![
                        ParameterDefinition {
                            name: "showStats".to_string(),
                            param_type: "boolean".to_string(),
                            description: "Current visibility state of stats".to_string(),
                            required: true,
                            validation: None,
                        },
                    ],
                    outputs: vec![
                        ParameterDefinition {
                            name: "showStats".to_string(),
                            param_type: "boolean".to_string(),
                            description: "Updated visibility state".to_string(),
                            required: true,
                            validation: None,
                        },
                    ],
                    required_capabilities: vec![],
                },
            ],
            capabilities: vec![
                Capability::Network {
                    value: NetworkCapability {
                        networks: vec!["mainnet".to_string(), "testnet".to_string()],
                        operations: vec!["query".to_string()],
                    },
                },
            ],
            plugins: vec![],
        };

        serde_json::to_string(&info)
            .map_err(|e| JsValue::from_str(&format!("Failed to serialize info: {}", e)))
    }

    #[wasm_bindgen(js_name = POST)]
    pub async fn post(
        &self,
        action: &str,
        params: &str,
        network: &str,
        hash_link_memo: &str,
    ) -> Result<String, JsValue> {
        let params_json: serde_json::Value = serde_json::from_str(params)
            .map_err(|e| JsValue::from_str(&format!("Failed to parse params: {}", e)))?;

        match action {
            "increment" => {
                let amount = params_json.get("amount")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(1.0) as i32;

                let count = params_json.get("count")
                    .and_then(|v| v.as_f64())
                    .ok_or_else(|| JsValue::from_str("Missing required parameter: count"))? as i32;

                let new_count = count + amount;

                Ok(json!({
                    "success": true,
                    "data": {
                        "count": new_count
                    },
                    "message": format!("Counter incremented by {} to {}", amount, new_count)
                }).to_string())
            }
            "decrement" => {
                let amount = params_json.get("amount")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(1.0) as i32;

                let count = params_json.get("count")
                    .and_then(|v| v.as_f64())
                    .ok_or_else(|| JsValue::from_str("Missing required parameter: count"))? as i32;

                let new_count = count - amount;

                Ok(json!({
                    "success": true,
                    "data": {
                        "count": new_count
                    },
                    "message": format!("Counter decremented by {} to {}", amount, new_count)
                }).to_string())
            }
            "reset" => {
                Ok(json!({
                    "success": true,
                    "data": {
                        "count": 0
                    },
                    "message": "Counter reset to 0"
                }).to_string())
            }
            "toggleCounter" => {
                let show_counter = params_json.get("showCounter")
                    .and_then(|v| v.as_bool())
                    .ok_or_else(|| JsValue::from_str("Missing required parameter: showCounter"))?;

                let new_state = !show_counter;

                Ok(json!({
                    "success": true,
                    "data": {
                        "showCounter": new_state
                    },
                    "message": format!("Counter visibility toggled to {}", new_state)
                }).to_string())
            }
            "toggleStats" => {
                let show_stats = params_json.get("showStats")
                    .and_then(|v| v.as_bool())
                    .ok_or_else(|| JsValue::from_str("Missing required parameter: showStats"))?;

                let new_state = !show_stats;

                Ok(json!({
                    "success": true,
                    "data": {
                        "showStats": new_state
                    },
                    "message": format!("Stats visibility toggled to {}", new_state)
                }).to_string())
            }
            _ => Ok(json!({
                "success": false,
                "error": format!("Unknown action: {}", action)
            }).to_string())
        }
    }

    #[wasm_bindgen(js_name = GET)]
    pub async fn get(
        &self,
        action: &str,
        params: &str,
        network: &str,
    ) -> Result<String, JsValue> {
        match action {
            "increment" => {
                Ok(json!({
                    "title": "Increment Counter",
                    "description": "Increase the counter value",
                    "label": "Increment",
                    "parameters": [
                        {
                            "type": "number",
                            "name": "amount",
                            "label": "Amount to increment",
                            "required": false,
                            "default": 1,
                            "min": 1,
                            "max": 100
                        }
                    ]
                }).to_string())
            }
            "decrement" => {
                Ok(json!({
                    "title": "Decrement Counter",
                    "description": "Decrease the counter value",
                    "label": "Decrement",
                    "parameters": [
                        {
                            "type": "number",
                            "name": "amount",
                            "label": "Amount to decrement",
                            "required": false,
                            "default": 1,
                            "min": 1,
                            "max": 100
                        }
                    ]
                }).to_string())
            }
            "reset" => {
                Ok(json!({
                    "title": "Reset Counter",
                    "description": "Reset the counter to zero",
                    "label": "Reset",
                    "parameters": []
                }).to_string())
            }
            "toggleCounter" => {
                Ok(json!({
                    "title": "Toggle Counter",
                    "description": "Toggle visibility of the counter block",
                    "label": "Toggle Counter",
                    "parameters": []
                }).to_string())
            }
            "toggleStats" => {
                Ok(json!({
                    "title": "Toggle Stats",
                    "description": "Toggle visibility of the stats block",
                    "label": "Toggle Stats",
                    "parameters": []
                }).to_string())
            }
            _ => Ok(json!({
                "error": format!("Unknown action: {}", action)
            }).to_string())
        }
    }
}