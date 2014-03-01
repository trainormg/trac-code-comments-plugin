(function($) { $(function() {
	var _ = window.underscore,
		jQuery = $;  // just in case something uses jQuery() instead of $()
	$(document).ajaxError( function(e, xhr, options){
		var errorText = xhr.statusText;
		if (-1 == xhr.responseText.indexOf('<html')) {
			errorText += ': ' + xhr.responseText;
		} else {
			var traceback = $('#traceback pre', xhr.responseText).text();
			if (traceback) {
				errorText += '\n\nSee more in the console log.';
				console.log(traceback);
			}
		}
		alert(errorText);
	});

	CodeComments.$tableRows = $( CodeComments.tableSelectors ).not( '.comments' );

	window.Comment = Backbone.Model.extend({
	});

	window.CommentsList = Backbone.Collection.extend({
		model: Comment,
		url: CodeComments.comments_rest_url,
		comparator: function(comment) {
			return comment.get('time');
		},
		defaultFetchParams: {
			path: CodeComments.path || undefined,
			revision: CodeComments.revision,
			type: CodeComments.page
		},
		fetchTopComments: function() {
			return this.fetch( { data: _.extend( { line: 0 }, this.defaultFetchParams ) } );
		},
		fetchLineComments: function() {
			return this.fetch( { data: _.extend( { line__gt: 0 }, this.defaultFetchParams ) } );
		}
	});

	window.CommentView = Backbone.View.extend({
		tagName: 'li',
		template:  _.template(CodeComments.templates.comment),
		initialize: function() {
			this.model.bind('change', this.render, this);
			this.is_active = this.model.id == CodeComments.active_comment_id;
		},
		render: function() {
			$(this.el).html(this.template(_.extend(this.model.toJSON(), {
				delete_url: CodeComments.delete_url,
				active: this.is_active,
				can_delete: CodeComments.is_admin
			})));
			return this;
		},
		appendTo: function($el) {
			$el.append( this.render().el );
			if ( this.is_active ) {
				var comment_offset = $(this.el).offset();
				window.scrollTo( comment_offset.left, comment_offset.top );
			}
		}
	});

	window.TopCommentsView = Backbone.View.extend({
		id: 'top-comments',

		template:  _.template(CodeComments.templates.top_comments_block),
		events: {
			'click button': 'showAddCommentDialog'
		},

		initialize: function() {
			TopComments.bind('add',   this.addOne, this);
			TopComments.bind('reset', this.addAll, this);
		},

		render: function() {
			$(this.el).html(this.template());
			this.$('button').button();
			TopComments.fetchTopComments();
			return this;
		},

		addOne: function(comment) {
			var view = new CommentView({model: comment});
			view.appendTo( $( "ul.comments" ) );
		},
		addAll: function() {
			var view = this;
			TopComments.each(function(comment) {
				view.addOne.call(view, comment);
			});
		},
		showAddCommentDialog: function(e) {
			AddCommentDialog.open(TopComments);
		}

	});

	window.LineCommentsView = Backbone.View.extend({
		id: 'preview',
		initialize: function() {
			LineComments.bind('add',   this.addOne, this);
			LineComments.bind('reset', this.addAll, this);
			this.viewPerLine = {};
		},
		render: function() {
			LineComments.fetchLineComments();
		},
		addOne: function(comment) {
			var line = comment.get('line');
			if (!this.viewPerLine[line]) {
				this.viewPerLine[line] = new CommentsForALineView( { line: line } );

				var $tr = $( CodeComments.$tableRows[ line-1 ] );

				$tr.after(this.viewPerLine[line].render().el).addClass('with-comments');
			}
			this.viewPerLine[line].addOne(comment);
		},
		addAll: function() {
			var view = this;
			LineComments.each(function(comment) {
				view.addOne.call(view, comment);
			});
		}
	});

	window.CommentsForALineView = Backbone.View.extend({
		tagName: 'tr',
		className: 'comments',
		template: _.template(CodeComments.templates.comments_for_a_line),
		templateData: {},
		initialize: function(attrs) {
			this.line = attrs.line;
			this.templateData.colspan = ( 'changeset' === CodeComments.page ) ? 2 : 1;
		},
		events: {
			'click button': 'showAddCommentDialog'
		},
		render: function() {
			$( this.el ).html( this.template( this.templateData ) );
			this.$('button').button();
			return this;
		},
		addOne: function(comment) {
			if ( comment.get( 'line' ) != this.line ) {
				throw 'Trying to add a comment with line ' + comment.get( 'line' ) + ' into a view for line ' + this.line;
			}
			var view = new CommentView({model: comment});
			view.appendTo( $( "ul.comments" ) );
		},
		showAddCommentDialog: function() {
			var $parentRow = $( this.el ).prev()[0],
				$th = ( $( 'th', $parentRow ).length) ? $( 'th', $parentRow ) : $parentRow,
				$item = $th.last(),
				file = $item.parents( 'li' ).find( 'h2>a:first' ).text(),
				line = $.inArray( $parentRow, CodeComments.$tableRows ) + 1,
				displayLine = $item.text().trim() || $th.first().text() + ' (deleted)';

			AddCommentDialog.open( LineComments, this.line, file, displayLine );
		}
	});

	window.AddCommentDialogView = Backbone.View.extend({
		id: 'add-comment-dialog',
		template:  _.template(CodeComments.templates.add_comment_dialog),
		events: {
			'click button.add-comment': 'createComment',
			'keyup textarea': 'previewThrottled'
		},
		initialize: function(options) {
			this.$el = $(this.el);
		},
		render: function() {
			this.$el.html(this.template({formatting_help_url: CodeComments.formatting_help_url}))
				.dialog({ autoOpen: false, title: 'Add Comment', close: this.close });
			this.$('button.add-comment').button();
			return this;
		},
		open: function( collection, line, file, displayLine ) {
			this.path = ( '' === CodeComments.path ) ? file : CodeComments.path;
			this.line = line;
			this.collection = collection;
			var title = this.buildDialogTitle( line, file, displayLine );
			this.$el.dialog( 'open' ).dialog( { title: title } );
		},
		buildDialogTitle: function( line, file, displayLine ) {
			displayLine = displayLine || line;
			var title = 'Add comment for ';
			if( '' === CodeComments.path || typeof CodeComments.path === 'undefined' ) {
				title += ( displayLine ? 'line ' + displayLine + ' of ' + file + ' in ' : '' )
				      + 'Changeset '  + CodeComments.revision;
			}
			else {
				title += ( displayLine ? 'line ' + displayLine + ' of ' : '' )
				      + this.path + '@' + CodeComments.revision;
			}
			return title;
		},
		close: function() {
			$( 'button.ui-state-focus' ).blur();
		},
		createComment: function(e) {
			var self = this;
			var text = this.$('textarea').val();
			var line = this.line? this.line : 0;
			if (!text) return;
			var options = {
				success: function() {
					self.$('textarea').val('');
					self.$el.dialog('close');
				}
			};
			this.collection.create({text: text, author: CodeComments.username, path: this.path, revision: CodeComments.revision, line: line, type: CodeComments.page}, options);
		},
		previewThrottled: $.throttle(1500, function(e) { return this.preview(e); }),
		preview: function(e) {
			var view = this;
			$.get(CodeComments.preview_url, {text: this.$('textarea').val()}, function(data) {
				view.$('div.preview').html(data);
				view.$('h3').toggle(data !== '');
			});
		}
	});

	window.LineCommentBubblesView = Backbone.View.extend({
		render: function() {
			// wrap TH contents in spans so we can hide/show them
			$( 'th', CodeComments.$tableRows ).each( function( i, elem ) {
				elem.innerHTML = '<span>' + elem.innerHTML + '</span>';
			});

			var callbackMouseover = function( event ) {
				var $th = ( $( 'th', this ).length) ? $( 'th', this ) : $( this ),
					$item = $th.last(),
					file = $item.parents( 'li' ).find( 'h2>a:first' ).text(),
					line = $.inArray( this, CodeComments.$tableRows ) + 1,
					displayLine = $item.text().trim() || $th.first().text() + ' (deleted)';

				$item.children().css( 'display', 'none' );

				$item.prepend( '<a title="Comment on this line" href="#L' + line + '" class="bubble"><span class="ui-icon ui-icon-comment"></span></a>' );

				$( 'a.bubble' ).click( function( e ) {
					e.preventDefault();
					AddCommentDialog.open( LineComments, line, file, displayLine );
				} );
			};

			var callbackMouseout = function( event ) {
				var $th = $( 'th', this ).length ? $( 'th', this ) : $( this );
				$( 'a.bubble', $th ).remove();
				$th.children().css( 'display', '' );
			};

			CodeComments.$tableRows.hover( callbackMouseover, callbackMouseout );
		}
	});

	window.RowsView = Backbone.View.extend( {
		initialize: function( atts ) {
			this.$el = $( this.el );
			this.$rows = $( 'tr', atts.tableSelector );
		},
		render: function() {
			// wrap TH content in spans so we can hide/show them
			this.wrapTHsInSpans();
		},
		getLineByTR: function( tr ) {
			return $.inArray( tr, this.$rows ) + 1;
		},
		getTrByLineNumber: function( line ) {
			return this.$rows[line - 1];
		},
		wrapTHsInSpans: function() {
			$( 'th', this.$rows ).each( function( i, elem ) {
				elem.innerHTML = '<span>' + elem.innerHTML + '</span>';
			});
		},
		hover: function( enter, leave ) {
			return this.$rows.hover( enter, leave );
		},
		getNumberOfTHsPerRow: function() {
			return this.$rows.eq( 0 ).find( 'th' ).length;
		}
	} );

	window.TopComments = new CommentsList();
	window.LineComments = new CommentsList();
	window.TopCommentsBlock = new TopCommentsView();
	window.LineCommentsBlock = new LineCommentsView();
	window.AddCommentDialog = new AddCommentDialogView();
	window.LineCommentBubbles = new LineCommentBubblesView({el: $('#preview, .diff .entries')});

	$(CodeComments.selectorToInsertBefore).before(TopCommentsBlock.render().el);
	LineCommentsBlock.render();
	AddCommentDialog.render();
	LineCommentBubbles.render();
}); }( jQuery.noConflict( true ) ) );
