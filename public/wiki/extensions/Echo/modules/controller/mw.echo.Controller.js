( function () {
	/* global moment:false */
	/**
	 * Controller for Echo notifications
	 *
	 * @param {mw.echo.api.EchoApi} echoApi Echo API
	 * @param {mw.echo.dm.ModelManager} manager Model manager
	 */
	mw.echo.Controller = function MwEchoController( echoApi, manager ) {
		this.api = echoApi;
		this.manager = manager;
	};

	/* Initialization */

	OO.initClass( mw.echo.Controller );

	/**
	 * Update a filter value.
	 * The method accepts a filter name and as many arguments
	 * as needed.
	 *
	 * @param {string} filter Filter name
	 */
	mw.echo.Controller.prototype.setFilter = function ( filter ) {
		const filtersModel = this.manager.getFiltersModel(),
			values = Array.prototype.slice.call( arguments );

		values.shift();

		if ( filter === 'readState' ) {
			filtersModel.setReadState( values[ 0 ] );
		} else if ( filter === 'sourcePage' ) {
			filtersModel.setCurrentSourcePage( values[ 0 ], values[ 1 ] );
			this.manager.getLocalCounter().setSource( filtersModel.getSourcePagesModel().getCurrentSource() );
		}

		// Reset pagination
		this.manager.getPaginationModel().reset();
	};

	/**
	 * Fetch the next page by date
	 *
	 * @return {jQuery.Promise} A promise that resolves with an object where the keys are
	 *  days and the items are item IDs.
	 */
	mw.echo.Controller.prototype.fetchNextPageByDate = function () {
		this.manager.getPaginationModel().forwards();
		return this.fetchLocalNotificationsByDate();
	};

	/**
	 * Fetch the previous page by date
	 *
	 * @return {jQuery.Promise} A promise that resolves with an object where the keys are
	 *  days and the items are item IDs.
	 */
	mw.echo.Controller.prototype.fetchPrevPageByDate = function () {
		this.manager.getPaginationModel().backwards();
		return this.fetchLocalNotificationsByDate();
	};

	/**
	 * Fetch the first page by date
	 *
	 * @return {jQuery.Promise} A promise that resolves with an object where the keys are
	 *  days and the items are item IDs.
	 */
	mw.echo.Controller.prototype.fetchFirstPageByDate = function () {
		this.manager.getPaginationModel().setCurrPageIndex( 0 );
		return this.fetchLocalNotificationsByDate();
	};

	/**
	 * Fetch unread pages in all wikis and create foreign API sources
	 * as needed.
	 *
	 * @return {jQuery.Promise} A promise that resolves when the page filter
	 *  model is updated with the unread notification count per page per wiki
	 */
	mw.echo.Controller.prototype.fetchUnreadPagesByWiki = function () {
		const filterModel = this.manager.getFiltersModel(),
			sourcePageModel = filterModel.getSourcePagesModel();

		return this.api.fetchUnreadNotificationPages()
			.then( ( data ) => {
				const result = {},
					foreignSources = {};

				for ( const source in data ) {
					if ( source !== mw.config.get( 'wgWikiID' ) ) {
						// Collect sources for API
						foreignSources[ source ] = data[ source ].source;
					}
					result[ source === mw.config.get( 'wgWikiID' ) ? 'local' : source ] = data[ source ];
				}

				// Register the foreign sources in the API
				this.api.registerForeignSources( foreignSources, false );

				// Register pages
				sourcePageModel.setAllSources( result );
			} );
	};

	/**
	 * Fetch notifications from the local API and sort them by date.
	 * This method ignores cross-wiki notifications and bundles.
	 *
	 * @param {number} [page] Page number. If not given, it defaults to the current
	 *  page.
	 * @return {jQuery.Promise} A promise that resolves with an object where the keys are
	 *  days and the items are item IDs.
	 */
	mw.echo.Controller.prototype.fetchLocalNotificationsByDate = function ( page ) {
		const pagination = this.manager.getPaginationModel(),
			filters = this.manager.getFiltersModel(),
			currentSource = filters.getSourcePagesModel().getCurrentSource(),
			continueValue = pagination.getPageContinue( page || pagination.getCurrPageIndex() );

		pagination.setItemsPerPage( this.api.getLimit() );

		return this.api.fetchFilteredNotifications(
			this.manager.getTypeString(),
			currentSource,
			{
				continue: continueValue,
				readState: filters.getReadState(),
				titles: filters.getSourcePagesModel().getGroupedPagesForCurrentTitle()
			}
		)
			.then( ( data ) => {
				const dateItemIds = {},
					dateItems = {},
					models = {};

				data = data || { list: [] };

				// Go over the data
				for ( let i = 0; i < data.list.length; i++ ) {
					const notifData = data.list[ i ];

					// Set source's seenTime
					// TODO: This query brings up mixed alert and message notifications.
					// Regularly, each of those will have a different seenTime that is
					// calculated for each badge, but for this page, both are fetched.
					// For the moment, we are picking the max seenTime from
					// either alert or notice and updating both, since the page gives
					// us a mixed view which will update both seenTime to be the same
					// anyways.
					const maxSeenTime = data.seenTime.alert < data.seenTime.notice ?
						data.seenTime.notice : data.seenTime.alert;
					this.manager.getSeenTimeModel().setSeenTime(
						maxSeenTime
					);

					// Collect common data
					const newNotifData = this.createNotificationData( notifData );
					if ( notifData.type !== 'foreign' ) {
						const localizedDate = moment.utc( newNotifData.timestamp ).local().format( 'YYYYMMDD' );

						newNotifData.modelName = 'local_' + localizedDate;
						newNotifData.source = currentSource;

						// Single notifications
						const itemModel = new mw.echo.dm.NotificationItem(
							notifData.id,
							newNotifData
						);

						dateItems[ localizedDate ] = dateItems[ localizedDate ] || [];
						dateItems[ localizedDate ].push( itemModel );

						dateItemIds[ localizedDate ] = dateItemIds[ localizedDate ] || [];
						dateItemIds[ localizedDate ].push( notifData.id );
					}
				}

				// Fill in the models
				for ( const date in dateItems ) {
					const symbolicName = 'local_' + date;

					// Set up model
					models[ symbolicName ] = new mw.echo.dm.NotificationsList( {
						type: this.manager.getTypes(),
						name: symbolicName,
						source: currentSource,
						title: date,
						timestamp: date,
						sortingCallback: function ( a, b ) {
							// Reverse sorting. In the special page we want the
							// items sorted only by timestamp, regardless of
							// read/unread state
							if ( b.getTimestamp() < a.getTimestamp() ) {
								return -1;
							} else if ( b.getTimestamp() > a.getTimestamp() ) {
								return 1;
							}

							// Fallback on IDs
							return b.getId() - a.getId();
						}
					} );
					models[ symbolicName ].setItems( dateItems[ date ] );
				}

				// Register local sources
				this.api.registerLocalSources( Object.keys( models ) );

				// Update the manager
				this.manager.setNotificationModels( models );

				// Update the pagination
				pagination.setNextPageContinue( data.continue );

				// Update the local counter
				this.manager.getLocalCounter().update();

				return dateItemIds;
			} )
			.then(
				null,
				( errCode, errObj ) => ( {
					errCode: errCode,
					errInfo: OO.getProp( errObj, 'error', 'info' )
				} )
			);
	};
	/**
	 * Fetch notifications from the local API and update the notifications list.
	 *
	 * @param {boolean} [isForced] Force a renewed fetching promise. If set to false, the
	 *  model will request the stored/cached fetching promise from the API. A 'true' value
	 *  will force the API to re-request that information from the server and update the
	 *  notifications.
	 * @return {jQuery.Promise} A promise that resolves with an array of notification IDs
	 */
	mw.echo.Controller.prototype.fetchLocalNotifications = function ( isForced ) {
		// Create a new local list model
		const localListModel = new mw.echo.dm.NotificationsList( {
				type: this.manager.getTypes()
			} ),
			localItems = [],
			idArray = [];

		this.manager.counter.update();

		// Fetch the notifications from the database
		// Initially, we're going to have to split the operation
		// between local notifications and x-wiki notifications
		// until the backend gives us the x-wiki notifications as
		// part of the original response.
		return this.api.fetchNotifications( this.manager.getTypeString(), 'local', !!isForced, { unreadFirst: true, bundle: true } /* filters */ )
			.then(
				// Success
				( data ) => {
					const allModels = { local: localListModel },
						createBundledNotification = ( modelName, rawBundledNotifData ) => {
							const bundleNotifData = this.createNotificationData( rawBundledNotifData );
							bundleNotifData.bundled = true;
							bundleNotifData.modelName = modelName;
							return new mw.echo.dm.NotificationItem(
								rawBundledNotifData.id,
								bundleNotifData
							);
						};

					data = data || { list: [] };

					// Go over the data
					for ( let i = 0; i < data.list.length; i++ ) {
						const notifData = data.list[ i ];

						// Set source's seenTime
						this.manager.getSeenTimeModel().setSeenTime(
							this.getTypes().length > 1 ?
								(
									data.seenTime.alert < data.seenTime.notice ?
										data.seenTime.notice : data.seenTime.alert
								) :
								data.seenTime[ this.getTypeString() ]
						);

						// Collect common data
						const newNotifData = this.createNotificationData( notifData );
						if ( notifData.type === 'foreign' ) {
							// x-wiki notification multi-group
							// We need to request a new list model
							newNotifData.name = 'xwiki';
							const foreignListModel = allModels.xwiki = new mw.echo.dm.CrossWikiNotificationItem( notifData.id, newNotifData );
							foreignListModel.setForeign( true );

							// Register foreign sources
							this.api.registerForeignSources( notifData.sources, true );
							// Add the lists according to the sources
							for ( const source in notifData.sources ) {
								foreignListModel.getList().addGroup(
									source,
									notifData.sources[ source ]
								);
							}

						} else if ( Array.isArray( newNotifData.bundledNotifications ) ) {
							// local bundle
							newNotifData.modelName = 'bundle_' + notifData.id;
							const itemModel = new mw.echo.dm.BundleNotificationItem(
								notifData.id,
								newNotifData.bundledNotifications.map( createBundledNotification.bind( null, newNotifData.modelName ) ),
								newNotifData
							);
							allModels[ newNotifData.modelName ] = itemModel;
						} else {
							// Local single notifications
							const itemModel = new mw.echo.dm.NotificationItem(
								notifData.id,
								newNotifData
							);

							idArray.push( notifData.id );
							localItems.push( itemModel );

							if ( newNotifData.bundledNotifications ) {
								// This means that bundledNotifications is truthy
								// but is not an array. We should log this in the console
								mw.log.warn(
									'newNotifData.bundledNotifications is expected to be an array,' +
									'but instead received "' + typeof newNotifData.bundledNotifications + '"'
								);
							}
						}

					}

					// Refresh local items
					localListModel.addItems( localItems );

					// Update the this
					this.manager.setNotificationModels( allModels );

					return idArray;
				},
				// Failure
				( errCode, errObj ) => {
					if ( !this.manager.getNotificationModel( 'local' ) ) {
						// Update the this
						this.manager.setNotificationModels( { local: localListModel } );
					}
					return {
						errCode: errCode,
						errInfo: OO.getProp( errObj, 'error', 'info' )
					};
				}
			);
	};

	/**
	 * Create notification data config object for notification items from the
	 * given API data.
	 *
	 * @param {Object} apiData API data
	 * @return {Object} Notification config data object
	 */
	mw.echo.Controller.prototype.createNotificationData = function ( apiData ) {
		const content = apiData[ '*' ] || {};

		let utcTimestamp;
		if ( apiData.timestamp.utciso8601 ) {
			utcTimestamp = apiData.timestamp.utciso8601;
		} else {
			// Temporary until c05133283af0486e08c9a97a468bc075e238f2d2 rolls out to the
			// whole WMF cluster
			const utcIsoMoment = moment.utc( apiData.timestamp.utcunix * 1000 );
			utcTimestamp = utcIsoMoment.format( 'YYYY-MM-DD[T]HH:mm:ss[Z]' );
		}

		return {
			type: apiData.section,
			foreign: false,
			source: 'local',
			count: apiData.count,
			read: !!apiData.read,
			seen: (
				!!apiData.read ||
				utcTimestamp <= this.manager.getSeenTime()
			),
			timestamp: utcTimestamp,
			category: apiData.category,
			content: {
				header: content.header,
				compactHeader: content.compactHeader,
				body: content.body
			},
			iconUrl: content.iconUrl,
			iconType: content.icon,
			primaryUrl: OO.getProp( content.links, 'primary', 'url' ),
			secondaryUrls: OO.getProp( content.links, 'secondary' ) || [],
			bundledIds: apiData.bundledIds,
			bundledNotifications: apiData.bundledNotifications
		};
	};

	/**
	 * Mark all items within a given list model as read.
	 *
	 * NOTE: This method is strictly for list models, and will not work for
	 * group list models. To mark items as read in the xwiki model, whether
	 * it is pre-populated or not, please see #markEntireCrossWikiItemAsRead
	 *
	 * @param {string} [modelName] Symbolic name for the model
	 * @param {boolean} [isRead=true]
	 * @return {jQuery.Promise} Promise that is resolved when all items
	 *  were marked as read.
	 */
	mw.echo.Controller.prototype.markEntireListModelRead = function ( modelName, isRead ) {
		const itemIds = [],
			model = this.manager.getNotificationModel( modelName || 'local' );

		if ( !model ) {
			// Model doesn't exist
			return $.Deferred().reject();
		}

		// Default to true
		isRead = isRead === undefined ? true : isRead;

		const items = model.getItems();
		for ( let i = 0; i < items.length; i++ ) {
			const item = items[ i ];
			if ( item.isRead() !== isRead ) {
				itemIds.push( item.getId() );
			}
		}

		return this.markItemsRead( itemIds, model.getName(), isRead );
	};

	/**
	 * Mark all notifications of a certain source as read, even those that
	 * are not currently displayed.
	 *
	 * @param {string} [source] Notification source. If not given, the currently
	 *  selected source is used.
	 * @return {jQuery.Promise} A promise that is resolved after
	 *  all notifications for the given source were marked as read
	 */
	mw.echo.Controller.prototype.markAllRead = function ( source ) {
		const itemIds = [],
			readState = this.manager.getFiltersModel().getReadState(),
			localCounter = this.manager.getLocalCounter();

		source = source || this.manager.getFiltersModel().getSourcePagesModel().getCurrentSource();

		this.manager.getNotificationsBySource( source ).forEach( ( notification ) => {
			if ( !notification.isRead() ) {
				itemIds.push( ...notification.getAllIds() );
				notification.toggleRead( true );

				if ( readState === 'unread' ) {
					// Remove the items if we are in 'unread' filter state
					const model = this.manager.getNotificationModel( notification.getModelName() );
					model.discardItems( notification );
				}
			}
		} );

		// Update pagination count
		this.manager.updateCurrentPageItemCount();

		localCounter.estimateChange( -itemIds.length );
		return this.api.markAllRead(
			source,
			this.getTypes()
		).then(
			this.refreshUnreadCount.bind( this )
		).then(
			localCounter.update.bind( localCounter, true )
		);
	};

	/**
	 * Mark all local notifications as read
	 *
	 * @return {jQuery.Promise} Promise that is resolved when all
	 *  local notifications have been marked as read.
	 */
	mw.echo.Controller.prototype.markLocalNotificationsRead = function () {
		const readState = this.manager.getFiltersModel().getReadState(),
			modelItems = {};

		this.manager.getLocalNotifications().forEach( ( notification ) => {
			if ( !notification.isRead() ) {
				notification.toggleRead( true );

				const modelName = notification.getModelName();
				modelItems[ modelName ] = modelItems[ modelName ] || [];
				modelItems[ modelName ].push( notification );
			}
		} );

		// Remove the items if we are in 'unread' filter state
		if ( readState === 'unread' ) {
			for ( const name in modelItems ) {
				const model = this.manager.getNotificationModel( name );
				model.discardItems( modelItems[ name ] );
			}
		}

		// Update pagination count
		this.manager.updateCurrentPageItemCount();

		this.manager.getLocalCounter().setCount( 0, false );
		return this.api.markAllRead( 'local', this.getTypeString() ).then( this.refreshUnreadCount.bind( this ) );
	};

	/**
	 * Fetch notifications from the cross-wiki sources.
	 *
	 * @return {jQuery.Promise} Promise that is resolved when all items
	 *  from the cross-wiki sources are populated into the cross-wiki
	 *  model.
	 */
	mw.echo.Controller.prototype.fetchCrossWikiNotifications = function () {
		const xwikiModel = this.manager.getNotificationModel( 'xwiki' );

		if ( !xwikiModel ) {
			// There is no xwiki notifications model, so we can't
			// fetch into it
			return $.Deferred().reject().promise();
		}

		return this.api.fetchNotificationGroups( xwikiModel.getSourceNames(), this.manager.getTypeString(), true )
			.then(
				( groupList ) => {
					for ( const group in groupList ) {
						const listModel = xwikiModel.getItemBySource( group );
						const groupItems = groupList[ group ];

						const items = [];
						for ( let i = 0; i < groupItems.length; i++ ) {
							const notifData = this.createNotificationData( groupItems[ i ] );
							items.push(
								new mw.echo.dm.NotificationItem( groupItems[ i ].id, Object.assign( notifData, {
									modelName: 'xwiki',
									source: group,
									bundled: true,
									foreign: true
								} ) )
							);
						}
						// Add items
						listModel.setItems( items );
					}
				},
				( errCode, errObj ) => ( {
					errCode: errCode,
					errInfo: errCode === 'http' ?
						mw.msg( 'echo-api-failure-cross-wiki' ) :
						OO.getProp( errObj, 'error', 'info' )
				} )
			);
	};

	/**
	 * Mark local items as read in the API.
	 *
	 * @param {string[]|string} itemIds An array of item IDs, or a single item ID, to mark as read
	 * @param {string} modelName The name of the model that these items belong to
	 * @param {boolean} [isRead=true] The read state of the item; true for marking the
	 *  item as read, false for marking the item as unread
	 * @return {jQuery.Promise} A promise that is resolved when the operation
	 *  is complete, with the number of unread notifications still remaining
	 *  for the set type of this controller, in the given source.
	 */
	mw.echo.Controller.prototype.markItemsRead = function ( itemIds, modelName, isRead ) {
		const model = this.manager.getNotificationModel( modelName ),
			readState = this.manager.getFiltersModel().getReadState(),
			allIds = [];

		itemIds = Array.isArray( itemIds ) ? itemIds : [ itemIds ];

		// Default to true
		isRead = isRead === undefined ? true : isRead;

		const items = model.findByIds( itemIds );

		// If we are only looking at specific read state,
		// then we need to make sure the items are removed
		// from the visible list, because they no longer
		// correspond with the chosen state filter
		if ( readState === 'read' && !isRead ) {
			model.discardItems( items );
		} else if ( readState === 'unread' && isRead ) {
			model.discardItems( items );
			// TODO: We should also find a way to update the pagination
			// here properly. Do we pull more items from the next page
			// when items are cleared? Do we set some threshhold for
			// removed items where if it is reached, we update the list
			// to reflect the new pagination? etc.
		}

		items.forEach( ( notification ) => {
			allIds.push( ...notification.getAllIds() );
			if ( readState === 'all' ) {
				notification.toggleRead( isRead );
			}
		} );

		// Update pagination count
		this.manager.updateCurrentPageItemCount();

		this.manager.getUnreadCounter().estimateChange( isRead ? -allIds.length : allIds.length );
		if ( modelName !== 'xwiki' ) {
			// For the local counter, we should only estimate the change if the items
			// are not cross-wiki
			this.manager.getLocalCounter().estimateChange( isRead ? -allIds.length : allIds.length );
		}

		return this.api.markItemsRead( allIds, model.getSource(), isRead ).then( this.refreshUnreadCount.bind( this ) );
	};

	/**
	 * Mark cross-wiki items as read in the API.
	 *
	 * @param {string[]|string} itemIds An array of item IDs, or a single item ID, to mark as read
	 * @param {string} source The name for the source list that these items belong to
	 * @return {jQuery.Promise} A promise that is resolved when the operation
	 *  is complete, with the number of unread notifications still remaining
	 *  for the set type of this controller, in the given source.
	 */
	mw.echo.Controller.prototype.markCrossWikiItemsRead = function ( itemIds, source ) {
		const allIds = [],
			xwikiModel = this.manager.getNotificationModel( 'xwiki' );

		if ( !xwikiModel ) {
			return $.Deferred().reject().promise();
		}
		itemIds = Array.isArray( itemIds ) ? itemIds : [ itemIds ];

		const sourceModel = xwikiModel.getList().getGroupByName( source );
		const notifs = sourceModel.findByIds( itemIds );
		sourceModel.discardItems( notifs );
		// Update pagination count
		this.manager.updateCurrentPageItemCount();

		notifs.forEach( ( notif ) => {
			allIds.push( ...notif.getAllIds() );
		} );
		this.manager.getUnreadCounter().estimateChange( -allIds.length );
		return this.api.markItemsRead( allIds, source, true )
			.then( this.refreshUnreadCount.bind( this ) );
	};

	/**
	 * Mark all cross-wiki notifications from all sources as read
	 *
	 * @return {jQuery.Promise} Promise that is resolved when all notifications
	 *  are marked as read
	 */
	mw.echo.Controller.prototype.markEntireCrossWikiItemAsRead = function () {
		const xwikiModel = this.manager.getNotificationModel( 'xwiki' );

		if ( !xwikiModel ) {
			return $.Deferred().reject().promise();
		}

		this.manager.getUnreadCounter().estimateChange( -xwikiModel.getCount() );

		return this.api.fetchNotificationGroups( xwikiModel.getSourceNames(), this.manager.getTypeString() )
			.then( ( groupList ) => {
				const promises = [];

				for ( const group in groupList ) {
					const listModel = xwikiModel.getItemBySource( group );
					const groupItems = groupList[ group ];

					const idArray = [];
					for ( let i = 0; i < groupItems.length; i++ ) {
						idArray.push( groupItems[ i ].id, ...( groupItems[ i ].bundledIds || [] ) );
					}

					// Mark items as read in the API
					promises.push(
						this.api.markItemsRead( idArray, listModel.getName(), true )
					);
				}

				// Synchronously remove this model from the widget
				this.removeCrossWikiItem();

				return mw.echo.api.NetworkHandler.static.waitForAllPromises( promises ).then(
					this.refreshUnreadCount.bind( this )
				);
			} );
	};

	/**
	 * Remove the entire cross-wiki model.
	 */
	mw.echo.Controller.prototype.removeCrossWikiItem = function () {
		this.manager.removeNotificationModel( 'xwiki' );
	};

	/**
	 * Refresh the unread notifications counter
	 *
	 * @return {jQuery.Promise} A promise that is resolved when the counter
	 *  is updated with the actual unread count from the server.
	 */
	mw.echo.Controller.prototype.refreshUnreadCount = function () {
		return this.manager.getUnreadCounter().update();
	};

	/**
	 * Update global seenTime for all sources
	 *
	 * @return {jQuery.Promise} A promise that is resolved when the
	 *  seenTime was updated for all the controller's types and sources.
	 */
	mw.echo.Controller.prototype.updateSeenTime = function () {
		return this.api.updateSeenTime(
			this.getTypes(),
			// For consistency, use current source, though seenTime
			// will be updated globally
			this.manager.getFiltersModel().getSourcePagesModel().getCurrentSource()
		)
			.then( ( time ) => {
				this.manager.getSeenTimeModel().setSeenTime( time );
			} );
	};

	/**
	 * Perform a dynamic action
	 *
	 * @param {Object} data Action data for the network
	 * @param {string} [source] Requested source to query. Defaults to currently
	 *  selected source.
	 * @return {jQuery.Promise} jQuery promise that resolves when the action is done
	 */
	mw.echo.Controller.prototype.performDynamicAction = function ( data, source ) {
		source = source || this.manager.getFiltersModel().getSourcePagesModel().getCurrentSource();
		return this.api.queryAPI( data, source );
	};

	/**
	 * Get the types associated with the controller and model
	 *
	 * @return {string[]} Notification types
	 */
	mw.echo.Controller.prototype.getTypes = function () {
		return this.manager.getTypes();
	};

	/**
	 * Return a string representation of the notification type.
	 * It could be 'alert', 'message' or, if both are set, 'all'
	 *
	 * @return {string} String representation of notifications type
	 */
	mw.echo.Controller.prototype.getTypeString = function () {
		return this.manager.getTypeString();
	};
}() );
