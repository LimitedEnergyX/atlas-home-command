# Demo data and UniFi basis of design

## Source boundaries

- Energy: approved historical Tesla readings, without household identifiers.
- Pantry: seven staple names and four recipe names and ingredient lists read from the owner's library, approved for the demo. No private recipe IDs, credentials, account URLs, preparation prose, or purchase history are included.
- Meal planning: four illustrative dinners for the next calendar week. Nine grocery items are pending purchase, including eight missing recipe ingredients and bread. No order or live meal plan was created.
- Travel: two wholly fictional trips, DFW to SJC via DEN for personal travel and DFW to IAD for work. United Airlines, United Explorer, IHG, and Hertz replace the private travel brands. All flight numbers, schedules, hotels, bookings, costs, confirmations, balances, and status examples are fictional. Qualification meters are personal example goals, not published program thresholds. Coverage and lounge admission remain unverified.
- Network and security: simulated values and generic device names. No actual UniFi controller has been contacted. No scan, arm/disarm action, monitoring job, firewall change, or device command is performed.
- Vehicle charging: fictional readings and reviewed-reference examples. Home-source energy is shown only where the example explicitly supplies it. Rated miles are not inferred from kWh. Sample readings are not a complete session history.
- Calendar: two fictional date references, separate from the energy-history date selector. No connected calendar is queried or changed by the demo.
- Vehicles: Tesla Model Y, Chevrolet Silverado, and Harley-Davidson examples with generated photographic-style artwork and fictional service records. No owner vehicle photos, plates, VINs, or documents are included in these additions.
- House artwork: Sol reuses the owner's existing hilltop-house illustration with explicit approval. It depicts the owner's property. The separate Home hero is unchanged. Historical energy samples retain their recorded dates and are labeled as not live.
- Radar: a static, generated Dallas-Fort Worth storm scenario labeled simulated in the image and card. It is not current weather, a forecast, or a real alert.
- Maintenance: illustrative annual solar-panel cleaning record, not a booked service or universal recommended cleaning interval.

## Planned UniFi equipment

The owner's reference screenshot is the basis of design, not proof of purchase:

| Equipment | Quantity | Demo role |
|---|---:|---|
| Cloud Gateway Fiber, 1 TB | 1 | Gateway and Network controller |
| Flex 2.5G PoE | 1 | Core switch, 10G SFP+ uplink |
| U7 Pro Max | 3 | Living, office, and bedroom wings |

The screenshot's memory-surcharge line items are not additional network devices. Prices are omitted because no current quote is being prepared.

The [Cloud Gateway Fiber specifications](https://techspecs.ui.com/unifi/cloud-gateways/ucg-fiber) describe 10G and 2.5G interfaces, a 30 W PoE budget, and IDS/IPS capability. The [U7 Pro Max specifications](https://techspecs.ui.com/unifi/wifi/u7-pro-max) list 2.5 GbE uplink, PoE+ power, and a 25 W maximum per AP. Three APs therefore have a 75 W combined maximum, before other loads.

The [Flex 2.5G PoE specifications](https://techspecs.ui.com/unifi/switching/usw-flex-2-5g-8-poe) list eight 2.5 GbE PoE ports, 10G connectivity, and different PoE budgets by supply. The demo assumes the 210 W AC adapter with 196 W available for PoE. Its simulated current AP draw is 46.6 W. Do not assume the gateway can power the whole AP set through the switch.

**Constraint:** The screenshot does not establish which switch power adapter is included.

**Proposed solution:** Confirm the 210 W AC adapter or an appropriately rated alternative before installation.

**Cost / impact:** May add an accessory purchase; no purchase or electrical work is authorized by this demo.

**Timeline:** Verify when the equipment order is finalized. No installation schedule is established.

## Future collection plan

The [official UniFi API overview](https://help.ui.com/hc/en-us/articles/30076656117655-Getting-Started-with-the-Official-UniFi-API) distinguishes local application APIs from the aggregated Site Manager API. The [Network API reference](https://developer.ui.com/network/v10.0.162) lists device, latest-statistics, client, and network resources. Installed-version documentation in Network > Integrations remains the implementation authority.

| Data shown | Intended source | Qualification |
|---|---|---|
| Model, online state, uptime, CPU, memory, transfer rates | Local Network device details and latest statistics | Poll only fields supported by the installed version |
| Connected clients and wired/wireless classification | Local Network clients and device relationships | Group locally; remove IPs, MACs, and account/device identifiers from public examples |
| Uplink, switch ports, PoE state and consumption | Device/interface details and available statistics | Exact PoE and radio telemetry exposure requires installed-version validation; do not rely on undocumented endpoints |
| WAN latency, loss, and Internet health | Site Manager metrics where available | This is separate from a local device-statistics query |
| Security and connection events | CEF log export | Not claimed to be part of the local latest-statistics endpoint |

[UniFi's CEF/SIEM documentation](https://help.ui.com/hc/en-us/articles/33349041044119-UniFi-System-Logs-SIEM-Integration) supports exporting device, client, administrative, and security activity. Atlas could group repeated events, retain evidence counts and timestamps, and surface actionable reviews. Grouped events are not confirmed attacks. No such collector is installed by this demo.

Zigbee door/window contacts and Echo ultrasonic motion belong to the separate home-automation integration, not UniFi. Their eventual availability depends on the chosen Zigbee bridge and supported Echo devices/integration. They are secondary awareness sensors, not a substitute for a monitored alarm or life-safety system.

## Brand reference

The [United Explorer page](https://creditcards.chase.com/travel-credit-cards/united/united-explorer) confirms the card and United Club one-time-pass concept. The demo's two passes are fictional account data, not a balance retrieved from Chase. [IHG's program page](https://www.ihg.com/onerewards/content/us/en/tier-benefits) documents IHG One Rewards and references Hertz Gold Plus Rewards. No account tier or eligibility was verified.
