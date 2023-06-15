# TODO

## Features

- [ ] members
- price problem does not exists
- [ ] booking request

  - user cyphers tx for booking
  - space host approves and sends executes the booking

- [ ] ERC20

  - before transfer
  - diamond pre-approved

- [ ] public sale

## Tools

- [ ] <https://louper.dev/>

## Security

- [ ] integrate some security analysis

      _example:_  Slither
        - https://medium.com/coinmonks/static-analysis-of-smart-contracts-with-slither-github-actions-1e67e54ed8a7
        - https://github.com/crytic/slither

## Diamond

- [ ] checklist for upgrading Diamonds <https://eip2535diamonds.substack.com/p/diamond-upgrades>

- [ ] Review and mark with annotations all AppStorage variables for updates with

  - [x] immutable struct
  - [x] mutable struct
  - [x] where to add variables
  - [ ] review storage slots and or verify

- [ ] move staking logic to a Library example: <https://github.com/aavegotchi/aavegotchi-contracts/blob/master/contracts/Aavegotchi/libraries/LibAavegotchi.sol#L252>

- [ ] review concerns <https://blog.trailofbits.com/2020/10/30/good-idea-bad-design-how-the-diamond-standard-falls-short/>
- [ ] review reply: <https://dev.to/mudgen/addressing-josselin-feist-s-concern-s-of-eip-2535-diamond-standard-me8>

_References:_

- <https://dev.to/mudgen/how-diamond-storage-works-90e>
- <https://dev.to/mudgen/how-to-share-functions-between-facets-of-a-diamond-1njb>
